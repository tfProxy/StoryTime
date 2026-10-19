import http from "node:http";
import { imagePromptRequest, parseImagePrompt, withArtStyle, writeImagePrompt } from "../../src/lib/ai/imagePrompt.ts";
import { estimateTokens } from "../../src/lib/ai/prompts.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const ch = (title: string, body: string, extra: Record<string, unknown> = {}) => ({ title, body, summary: null, path_summary: null, ...extra });
const cx = (name: string, content: string, extra: Record<string, unknown> = {}) => ({ id: name, name, type: "character", aliases: [] as string[], content, always_include: false, ...extra });
const story = { title: "The Tale", premise: "A kitchen comedy." };
const jim = cx("Jim", "A tall man with blonde hair and a green apron.");
const zed = cx("Zed", "A one-eyed pirate captain.");
const base = {
  story,
  path: [ch("One", "Jim made a sandwich in the kitchen.")],
  codex: [jim, zed],
  slot: "header" as const,
  direction: "",
  style: "tags" as const,
};

// ---- the system prompt: one per prompt style ----
const tags = imagePromptRequest(8000, { ...base, style: "tags" });
const natural = imagePromptRequest(8000, { ...base, style: "natural" });
ok(tags.system !== natural.system, "tags and natural styles have different system prompts");
ok(tags.system!.includes("comma-separated tags") && !tags.system!.includes("plain descriptive English"), "tags: asks for comma-separated tags");
ok(natural.system!.includes("plain descriptive English") && natural.system!.includes("sentences") && !natural.system!.includes("Stable Diffusion XL"), "natural: asks for sentences");
for (const [name, r] of [["tags", tags], ["natural", natural]] as const) {
  ok(r.system!.includes("never use character or place names"), `${name}: the model is told not to use names`);
  ok(r.system!.includes("Do not describe an art style") && r.system!.includes("added separately"), `${name}: the model is told not to describe an art style`);
  ok(r.system!.includes("Reply with JSON only") && r.system!.includes('"scene"') && r.system!.includes('"negative"'), `${name}: asks for the JSON shape`);
}
ok(tags.message === natural.message, "the message does not depend on the prompt style");

// ---- header and footer tasks ----
const header = imagePromptRequest(8000, { ...base, slot: "header" });
const footer = imagePromptRequest(8000, { ...base, slot: "footer" });
ok(header.message.includes("goes above the chapter's title") && !header.message.includes("closing moment"), "header task: set the scene near the beginning");
ok(footer.message.includes("closing moment") && footer.message.includes("goes after the chapter's text") && !footer.message.includes("goes above"), "footer task: the closing moment");
ok(header.message.includes('The chapter to illustrate, "One":\nJim made a sandwich in the kitchen.'), "the chapter's title and text are in the message");
ok(header.message.startsWith("Story: The Tale\n\nPremise: A kitchen comedy."), "the message starts with the story's title and premise");
ok(header.message.indexOf("The chapter to illustrate") < header.message.indexOf("This picture goes"), "the task comes after the chapter");

// ---- codex entries: picked by what the chapter mentions ----
ok(header.message.includes("Jim [character]: A tall man with blonde hair") && !header.message.includes("Zed"), "the entry the chapter mentions is in, an unmentioned one is not");
const always = imagePromptRequest(8000, { ...base, codex: [jim, cx("Zed", "A one-eyed pirate captain.", { always_include: true })] });
ok(always.message.includes("Zed [character]") && always.message.includes("Jim [character]"), "an always-include entry is in even when not mentioned");
const viaDirection = imagePromptRequest(8000, { ...base, direction: "Zed bursts in" });
ok(viaDirection.message.includes("Zed [character]: A one-eyed pirate captain."), "an entry named only in the author's direction is in");
const viaAlias = imagePromptRequest(8000, { ...base, codex: [cx("James", "Blonde.", { aliases: ["Jim"] })] });
ok(viaAlias.message.includes("James [character] (also: Jim)"), "an entry is found by its alias");
const noCodex = imagePromptRequest(8000, { ...base, codex: [] });
ok(!noCodex.message.includes("Codex"), "no codex block without entries");
ok(!imagePromptRequest(8000, { ...base, path: [ch("One", "Nobody here.")] }).message.includes("Codex"), "…or when none is mentioned");

// ---- direction and [notes] ----
ok(!header.message.includes("The author wants") && !header.message.includes("Additional instructions"), "no direction, no author section");
const dir = imagePromptRequest(8000, { ...base, direction: "Jim taking the first bite [close-up] [warm light]" });
ok(dir.message.includes("The author wants the picture to show: Jim taking the first bite\n"), "the direction is in, with the notes taken out");
ok(dir.message.includes("Additional instructions from the author") && dir.message.includes("- close-up") && dir.message.includes("- warm light") && !dir.message.includes("[close-up]"), "[notes] become additional instructions");
const onlyNote = imagePromptRequest(8000, { ...base, direction: "[wide shot]" });
ok(!onlyNote.message.includes("The author wants") && onlyNote.message.includes("- wide shot"), "a direction of only a note adds just the instruction");
ok(dir.message.indexOf("The author wants") > dir.message.indexOf("This picture goes"), "the direction comes after the task");

// ---- the story so far: only the chapter before ----
const two = [ch("One", "Opening.", { summary: "S-ONE", path_summary: "PS-ONE" }), ch("Two", "Jim ate.")];
const withPrev = imagePromptRequest(8000, { ...base, path: two });
ok(withPrev.message.includes("Earlier in the story:\nPS-ONE") && !withPrev.message.replace("PS-ONE", "").includes("S-ONE"), "the previous chapter's rolling summary appears as 'Earlier in the story'");
ok(imagePromptRequest(8000, { ...base, path: [ch("One", "Opening.", { summary: "S-ONE" }), ch("Two", "Jim ate.")] }).message.includes("Earlier in the story:\nS-ONE"), "…or its own summary when there is no rolling one");
ok(!imagePromptRequest(8000, { ...base, path: [ch("One", "Opening."), ch("Two", "Jim ate.")] }).message.includes("Earlier in the story"), "nothing earlier when the previous chapter has no summary");
ok(!header.message.includes("Earlier in the story"), "a first chapter has no earlier story");
ok(withPrev.message.includes('The chapter to illustrate, "Two"') && !withPrev.message.includes("Opening."), "only the last chapter of the path is the one illustrated");

// ---- a very long chapter is cut; the header keeps the start, the footer the end ----
const long = ch("Long", `STARTMARK ${"word ".repeat(40000)} ENDMARK`);
for (const tokens of [8000, 3000]) {
  const h = imagePromptRequest(tokens, { ...base, codex: [], path: [long], slot: "header" });
  const f = imagePromptRequest(tokens, { ...base, codex: [], path: [long], slot: "footer" });
  ok(h.message.includes("STARTMARK") && !h.message.includes("ENDMARK") && f.message.includes("ENDMARK") && !f.message.includes("STARTMARK"), `${tokens} tokens: header keeps the start, footer keeps the end`);
  ok(h.message.includes("…\n\nThis picture") && f.message.includes('"Long":\n…'), `${tokens} tokens: the cut is marked with an ellipsis`);
  const budget = tokens - 1500;
  ok(estimateTokens(h.message) <= budget + 400 && estimateTokens(f.message) <= budget + 400, `${tokens} tokens: the message fits near the budget (${estimateTokens(h.message)} <= ${budget})`);
}
const short = imagePromptRequest(8000, { ...base, codex: [], path: [ch("S", "x".repeat(2000))] });
ok(short.message.includes("x".repeat(2000)) && !short.message.includes("…"), "a chapter that fits is kept whole");

// ---- no chapter ----
try { imagePromptRequest(8000, { ...base, path: [] }); ok(false, "should throw"); } catch (e) { ok(/no chapter/.test((e as Error).message), "an empty path throws a friendly error"); }

// ---- reading the reply ----
let p = parseImagePrompt('Sure! Here you go:\n```json\n{"scene":" Jim eats. ","prompt":"  a man,  eating\\n a sandwich ","negative":"text, watermark"}\n```\nHope that helps');
ok(p.scene === "Jim eats." && p.prompt === "a man, eating a sandwich" && p.negative === "text, watermark", "parseImagePrompt: code fence and chatter are ignored, whitespace is tidied");
p = parseImagePrompt('{"prompt":"only a prompt"}');
ok(p.prompt === "only a prompt" && p.scene === "" && p.negative === "", "parseImagePrompt: missing scene and negative become empty");
p = parseImagePrompt('{"scene":5,"prompt":"p","negative":["a"]}');
ok(p.scene === "" && p.negative === "", "parseImagePrompt: values that aren't text become empty");
p = parseImagePrompt(JSON.stringify({ scene: "s".repeat(5000), prompt: "p".repeat(9000), negative: "n".repeat(5000) }));
ok(p.scene.length === 1000 && p.prompt.length === 4000 && p.negative.length === 2000, "parseImagePrompt: fields are capped");
for (const [name, reply] of [["empty prompt", '{"scene":"x","prompt":"  ","negative":"y"}'], ["no prompt key", '{"scene":"x"}'], ["prompt not text", '{"prompt":3}']] as const) {
  try { parseImagePrompt(reply); ok(false, `${name}: should throw`); } catch (e) { ok(/no prompt/.test((e as Error).message), `parseImagePrompt: ${name} throws`); }
}
try { parseImagePrompt("I cannot do that"); ok(false, "should throw"); } catch (e) { ok(/anything|JSON/.test((e as Error).message), "parseImagePrompt: no JSON at all throws a friendly error"); }

// ---- the art style ----
ok(withArtStyle("a man, kitchen", "watercolor, soft light", "tags") === "a man, kitchen, watercolor, soft light", "tags: the art style joins with a comma");
ok(withArtStyle("a man, kitchen,  ", "watercolor", "tags") === "a man, kitchen, watercolor", "tags: a trailing comma isn't doubled");
ok(withArtStyle("A man eats a sandwich", "Watercolor storybook", "natural") === "A man eats a sandwich. Watercolor storybook.", "natural: sentence punctuation is added");
ok(withArtStyle("A man eats!", "In watercolor.", "natural") === "A man eats! In watercolor.", "natural: existing punctuation is kept");
ok(withArtStyle("A man eats.", "Soft\n  light  ", "natural") === "A man eats. Soft light.", "natural: the art style's whitespace is collapsed");
ok(withArtStyle("  a man ", "", "tags") === "a man" && withArtStyle("A man.", "   ", "natural") === "A man.", "no art style leaves the prompt as it is (trimmed)");
ok(withArtStyle("", "watercolor", "tags") === "watercolor" && withArtStyle("  ", "watercolor", "natural") === "watercolor", "no prompt gives just the art style");

// ---- end to end against a fake model ----
const seen: { system: string; user: string; model: string }[] = [];
const server = http.createServer((req, res) => {
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data);
    seen.push({ system: body.messages[0].content, user: body.messages.at(-1).content, model: body.model });
    res.setHeader("content-type", "text/event-stream");
    const reply = 'Here:\n```json\n{"scene":"Jim eats.","prompt":"a man with blonde hair eating","negative":"text"}\n```';
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const settings: any = { ...DEFAULT_SETTINGS, connections: [{ id: "t", name: "Test", kind: "custom" as const, baseUrl: `http://localhost:${(server.address() as any).port}/v1`, apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } };
const written = await writeImagePrompt(settings, { ...base, slot: "footer", direction: "Jim eating" });
ok(written.prompt === "a man with blonde hair eating" && written.scene === "Jim eats.", "writeImagePrompt returns the parsed reply");
ok(seen[0].model === "cheap" && seen[0].user.includes("closing moment") && seen[0].user.includes("Jim [character]") && seen[0].system.includes("comma-separated tags"), "writeImagePrompt uses the cheaper model and sends the request");
server.close();
