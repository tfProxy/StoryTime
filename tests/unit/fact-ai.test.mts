import http from "node:http";
import { extractFacts, factRequest, parseFactReply } from "../../src/lib/ai/factAi.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- mock model ----
const prompts: { system: string; user: string; model: string }[] = [];
let handler: (user: string) => string = () => '{"facts":[]}';
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

const body = 'Mira, a green-eyed fox, lived in the Hollow.\n\nShe said, "I\'m not afraid." Her left ear was torn.';
const chapter = { title: "One", body };
const codexNames = ["Mira", "The Hollow"];

// ---- prompt ----
const req = factRequest(8000, { chapter, codexNames });
ok(/Reply with JSON only/.test(req.system!) && req.system!.includes('{"facts":[{"entity"'), "system: JSON-only instruction");
ok(req.system!.includes("Do not list events") && req.system!.includes("exact words"), "system: no events, exact quote");
ok(req.message.includes("Known names: Mira, The Hollow"), "codex names appear in the prompt");
ok(req.message.includes('Chapter to read: "One"') && req.message.includes("green-eyed fox"), "chapter text appears in the prompt");
ok(!factRequest(8000, { chapter, codexNames: [] }).message.includes("Known names"), "no names -> no names line");
ok(factRequest(8000, { chapter, codexNames: ["Mira", "mira", " ", "Mira "] }).message.includes("Known names: Mira\n"), "names deduped and trimmed");
ok(!factRequest(8000, { story: { title: "SecretTitle", premise: "SecretPremise" }, chapter, codexNames }).message.includes("Secret"), "story is not put in the prompt");
const long = "word ".repeat(30000);
const fitted = factRequest(4000, { chapter: { title: "Long", body: long }, codexNames });
ok(fitted.message.length < long.length / 4 && fitted.message.includes("…"), "long chapter is fitted to the context");
ok(!factRequest(4000, { chapter: { title: "S", body: "short text" }, codexNames }).message.includes("…"), "short chapter is left whole");

// ---- parseFactReply ----
const parsed = parseFactReply({ facts: [
  { entity: " Mira ", attribute: " Eye Colour ", value: "green", quote: " green-eyed fox " },
  { entity: "mira", attribute: "eye colour", value: "Green", quote: "dup" },
  { entity: "Mira", attribute: "eye colour", value: "blue", quote: "different value kept" },
  { entity: "Mira", attribute: "", value: "x", quote: "q" },
  { entity: "Mira", attribute: "home", value: 5, quote: "q" },
  { attribute: "home", value: "x", quote: "q" },
  { entity: "Mira", attribute: "home", value: "x" },
  "junk", null, 5,
] });
ok(parsed.length === 2, "duplicates, incomplete items and junk dropped");
ok(parsed[0].entity === "Mira" && parsed[0].attribute === "eye colour" && parsed[0].quote === "green-eyed fox", "fields trimmed, attribute lowercased");
ok(parsed[1].value === "blue", "same attribute with another value is kept");
const clipped = parseFactReply([{ entity: "e".repeat(500), attribute: "a".repeat(500), value: "v".repeat(500), quote: "q".repeat(500) }])[0];
ok(clipped.entity.length <= 80 && clipped.attribute.length <= 60 && clipped.value.length <= 120 && clipped.quote.length <= 240, "field lengths limited");
const many = parseFactReply(Array.from({ length: 100 }, (_, i) => ({ entity: "E", attribute: `a${i}`, value: "v", quote: "q" })));
ok(many.length === 40, "capped at 40 facts");
ok(parseFactReply(null).length === 0 && parseFactReply("x").length === 0 && parseFactReply({ facts: "no" }).length === 0 && parseFactReply({}).length === 0, "junk replies -> none");
ok(parseFactReply([{ entity: "A", attribute: "b", value: "c", quote: "d" }]).length === 1, "a bare array is accepted");

// ---- extractFacts ----
handler = () => JSON.stringify({ facts: [
  { entity: "Mira", attribute: "eye colour", value: "green", quote: "Mira, a green-eyed fox" },
  { entity: "Mira", attribute: "home", value: "the Hollow", quote: "lived in the hollow." },
  { entity: "Mira", attribute: "age", value: "ten", quote: "She was ten years old." },
  { entity: "Mira", attribute: "ear", value: "torn", quote: "Her left ear was torn." },
  { entity: "bad" },
] });
let facts = await extractFacts(settings, { chapter, codexNames });
ok(facts.length === 3 && !facts.some((f) => f.attribute === "age"), "good facts parsed; fact with an invented quote dropped; malformed item dropped");
ok(prompts.at(-1)!.model === "main" && prompts.at(-1)!.user.includes("Known names: Mira, The Hollow"), "main model by default, codex names sent");
const before = prompts.length;
await extractFacts(settings, { chapter, codexNames, role: "cheap" });
ok(prompts.at(-1)!.model === "cheap" && prompts.length === before + 1, "role is passed through to the cheap model");
ok((await extractFacts(settings, { chapter: { title: "Empty", body: "  " }, codexNames })).length === 0 && prompts.length === before + 1, "empty chapter -> no call");

handler = () => 'Sure! Here are the facts:\n```json\n{"facts":[{"entity":"Mira","attribute":"eye colour","value":"green","quote":"green-eyed fox"}]}\n```\nHope that helps.';
facts = await extractFacts(settings, { chapter, codexNames });
ok(facts.length === 1 && facts[0].value === "green", "JSON wrapped in prose and code fences is read");
handler = () => '{"facts":[]}';
ok((await extractFacts(settings, { chapter, codexNames })).length === 0, "empty result");
handler = () => "I cannot help";
try { await extractFacts(settings, { chapter, codexNames }); ok(false, "should throw"); } catch (e) { ok(/anything|JSON/.test((e as Error).message), "unreadable reply -> friendly error"); }
const ctl = new AbortController(); ctl.abort();
try { await extractFacts(settings, { chapter, codexNames, signal: ctl.signal }); ok(false, "should abort"); } catch (e) { ok((e as any).name === "AbortError", "aborts"); }

server.close();
