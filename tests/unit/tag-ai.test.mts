import http from "node:http";
import { draftRule, parseRuleReply, parseTagReply, quoteInText, ruleRequest, suggestTagsForChapter, tagRequest, type TagRule } from "../../src/lib/ai/tagAi.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- mock model ----
const prompts: { system: string; user: string; model: string }[] = [];
let handler: (user: string) => string = () => '{"tags":[]}';
const server = http.createServer((req, res) => {
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data);
    const user = body.messages.at(-1).content;
    prompts.push({ system: body.messages[0].content, user, model: body.model });
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: handler(user) } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as any).port}/v1`;
const settings: any = { ...DEFAULT_SETTINGS, connections: [{ id: "t", name: "Test", kind: "custom" as const, baseUrl: base, apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } };

const story = { title: "Tale", premise: "A thief." };
const tf: TagRule = {
  id: "t-tf", name: "TF", applies: "A character's body changes into another species on the page.", not_applies: "dreams; disguises; past events",
  choices: [], examples: [{ text: "Her hands became hooves.", applies: true }, { text: "She wore a horse mask.", applies: false, note: "a costume" }],
};
const gore: TagRule = { id: "t-gore", name: "Gore", applies: "Graphic injury is described.", not_applies: "", choices: ["mild", "graphic"], examples: [] };
const tags = [tf, gore];
const body = 'Mira said, "I\'m not afraid."\nThen her hands became hooves.\n\nBlood sprayed everywhere.';

// ---- prompt ----
const req = tagRequest(8000, { story, chapter: { title: "Two", body }, tags });
ok(req.system!.includes("only what actually happens on the page") && req.system!.includes("not sure, do not tag"), "system: page-only and when-unsure rules");
ok(/Reply with JSON only/.test(req.system!) && req.system!.includes('{"tags":[{"name"'), "system: JSON-only instruction");
ok(req.system!.includes("under 200 characters") && req.system!.includes("exactly one of them"), "system: quote length and choices rule");
ok(req.message.includes("Tag: TF") && req.message.includes("Applies when: A character's body changes") && req.message.includes("Doesn't apply when: dreams; disguises; past events"), "prompt carries each rule's fields");
ok(req.message.includes("Choices: mild, graphic") && !req.message.split("Tag: TF")[1].split("Tag: Gore")[0].includes("Choices:"), "choices shown only where present");
ok(req.message.includes('Counts: "Her hands became hooves."') && req.message.includes('Doesn\'t count: "She wore a horse mask." (a costume)'), "prompt carries examples with notes");
ok(req.message.includes('Chapter to read: "Two"') && req.message.includes("Then her hands became hooves.") && req.message.includes("Premise: A thief."), "prompt carries story and chapter");

const long = "word ".repeat(30000);
const fitted = tagRequest(4000, { story, chapter: { title: "Long", body: long }, tags });
ok(fitted.message.length < long.length / 4 && fitted.message.includes("…"), "long chapter is fitted to the context");
const whole = tagRequest(4000, { story, chapter: { title: "Short", body: "short text" }, tags });
ok(whole.message.includes("short text") && !whole.message.includes("…"), "short chapter is left whole");
const manyTags = Array.from({ length: 30 }, (_, i) => ({ ...tf, id: `m${i}`, name: `Tag ${i}` }));
ok(tagRequest(4000, { story, chapter: { title: "x", body: "abc" }, tags: manyTags }).message.includes("Tag: Tag 29"), "all rules are kept whole");

// ---- parseTagReply ----
const parsed = parseTagReply({ tags: [
  { name: " tf ", value: "x", quote: "  Her hands became hooves. ", reason: "Body changes." },
  { name: "GORE", value: "Graphic", quote: "Blood sprayed", reason: "r" },
  { name: "tf", quote: "dup", reason: "dup" },
  { name: "Unknown", quote: "q", reason: "r" },
  "junk", null, 5, { quote: "no name" },
] }, tags);
ok(parsed.length === 2, "unknown names, duplicates and junk dropped");
ok(parsed[0].tag_id === "t-tf" && parsed[0].value === null && parsed[0].quote === "Her hands became hooves.", "name matched case-insensitively, no choices -> null, quote trimmed");
ok(parsed[1].tag_id === "t-gore" && parsed[1].value === "graphic", "value matched to the canonical choice");
ok(parseTagReply({ tags: [{ name: "Gore", value: "extreme", quote: "q", reason: "r" }] }, tags)[0].value === null, "value not in choices -> null");
ok(parseTagReply({ tags: [{ name: "Gore", quote: "q", reason: "r" }] }, tags)[0].value === null, "missing value -> null");
const longOne = parseTagReply({ tags: [{ name: "TF", quote: "q".repeat(1000), reason: "r".repeat(1000) }] }, tags)[0];
ok(longOne.quote.length <= 240 && longOne.reason.length <= 300, "quote and reason lengths limited");
ok(parseTagReply({ tags: [{ name: "TF", quote: 5, reason: null }] }, tags)[0].quote === "", "non-string quote -> empty");
ok(parseTagReply(null, tags).length === 0 && parseTagReply("x", tags).length === 0 && parseTagReply({ tags: "no" }, tags).length === 0 && parseTagReply({}, tags).length === 0, "junk replies -> none");
ok(parseTagReply([{ name: "TF", quote: "q", reason: "r" }], tags).length === 1, "a bare array is accepted");

// ---- quote verification ----
ok(quoteInText("Then her hands became hooves.", body), "verbatim quote found");
ok(quoteInText("Then her   hands\nbecame hooves.", body), "whitespace variants found");
ok(quoteInText("Mira said, “I’m not afraid.”", body), "curly quotes found");
ok(quoteInText("mira said, \"i'm not afraid.\"", body), "case ignored");
ok(quoteInText("...hands became hooves...", body), "leading/trailing ellipsis ignored");
ok(quoteInText("hooves. Blood sprayed", body), "quote spanning a paragraph break found");
ok(!quoteInText("Her hands became wings.", body), "invented quote not found");
ok(!quoteInText("", body) && !quoteInText("   ", body), "empty quote not found");

// ---- suggestTagsForChapter ----
handler = () => JSON.stringify({ tags: [
  { name: "TF", value: null, quote: "her hands became hooves", reason: "Hands turn to hooves." },
  { name: "Gore", value: "graphic", quote: "Entrails everywhere.", reason: "invented quote" },
] });
let s = await suggestTagsForChapter(settings, { story, chapter: { title: "Two", body }, tags });
ok(s.length === 1 && s[0].tag_id === "t-tf", "suggestion with an invented quote is dropped");
ok(prompts.at(-1)!.model === "main" && prompts.at(-1)!.user.includes("Tag: Gore"), "one call to the main model carrying the rules");
const before = prompts.length;
await suggestTagsForChapter(settings, { story, chapter: { title: "Two", body }, tags, role: "cheap" });
ok(prompts.at(-1)!.model === "cheap" && prompts.length === before + 1, "role can be switched to the cheap model");
ok((await suggestTagsForChapter(settings, { story, chapter: { title: "Two", body }, tags: [] })).length === 0 && prompts.length === before + 1, "no tags -> no call");
handler = () => '```json\n{"tags":[]}\n```';
ok((await suggestTagsForChapter(settings, { story, chapter: { title: "Two", body }, tags })).length === 0, "empty result");
handler = () => "I cannot help";
try { await suggestTagsForChapter(settings, { story, chapter: { title: "Two", body }, tags }); ok(false, "should throw"); } catch (e) { ok(/anything|JSON/.test((e as Error).message), "unreadable reply -> friendly error"); }
const ctl = new AbortController(); ctl.abort();
try { await suggestTagsForChapter(settings, { story, chapter: { title: "Two", body }, tags, signal: ctl.signal }); ok(false, "should abort"); } catch (e) { ok((e as any).name === "AbortError", "aborts"); }

// ---- rule drafting ----
const rr = ruleRequest(undefined, { idea: "tf: a character changes species", name: "TF" });
ok(rr.message.includes("Tag name: TF") && rr.message.includes("Rough idea: tf: a character changes species"), "rule request carries name and idea");
ok(rr.system!.includes("near-misses") && rr.system!.includes("dream") && rr.system!.includes("disguise") && /Reply with JSON only/.test(rr.system!), "rule system prompt lists near-misses and asks for JSON");
try { ruleRequest(8000, { idea: "  " }); ok(false, "needs idea"); } catch (e) { ok(/Describe the tag/.test((e as Error).message), "rule request needs an idea"); }

handler = () => '```json\n{"name":"TF","applies":"A character changes species on the page.","not_applies":["dreams","disguises","past events","dreams"],"choices":["mild", "", "full"]}\n```';
let d = await draftRule(settings, { idea: "tf: a character changes species" });
ok(d.name === "TF" && d.applies === "A character changes species on the page." && d.not_applies === "dreams; disguises; past events" && d.choices.join() === "mild,full", "draftRule parses a good reply (list not_applies joined, choices cleaned)");
ok(prompts.at(-1)!.model === "main", "draftRule uses the main model");
handler = () => "Sure! Here you go: it should be about a tf.";
d = await draftRule(settings, { idea: "tf: a character changes species" });
ok(d.name === "tf" && d.applies === "a character changes species" && d.not_applies === "" && d.choices.length === 0, "bad JSON falls back to the idea");
d = await draftRule(settings, { idea: "characters get hurt", name: "Injury" });
ok(d.name === "Injury" && d.applies === "characters get hurt", "fallback keeps the given name and whole idea");
try { await draftRule(settings, { idea: "" }); ok(false, "needs idea"); } catch { ok(true, "draftRule with nothing to go on throws"); }
ok(parseRuleReply({ name: 5, applies: null, not_applies: 7, choices: "x" }, "a: b").applies === "b", "parseRuleReply: wrong types -> fallback");
ok(parseRuleReply([1, 2], "idea").applies === "idea" && parseRuleReply(null, "idea").choices.length === 0, "parseRuleReply: non-object -> fallback");
ok(parseRuleReply({ name: "N", applies: "A", not_applies: "x; y", choices: Array.from({ length: 20 }, (_, i) => `c${i}`) }, "i").choices.length === 8, "parseRuleReply: choices capped");

server.close();
