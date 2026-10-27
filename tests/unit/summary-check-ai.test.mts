import http from "node:http";
import { parseSummaryCheck, summaryCheck, summaryCheckRequest } from "../../src/lib/ai/summaryCheckAi.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- mock model ----
const prompts: { system: string; user: string; model: string }[] = [];
let reply = '{"ok":true}';
const server = http.createServer((req, res) => {
  let data = ""; req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = JSON.parse(data);
    prompts.push({ system: body.messages[0].content, user: body.messages.at(-1).content, model: body.model });
    res.setHeader("content-type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, r));
const base = `http://localhost:${(server.address() as any).port}/v1`;
const settings: any = { ...DEFAULT_SETTINGS, connections: [{ id: "t", name: "Test", kind: "custom" as const, baseUrl: base, apiKey: "" }], defaults: { main: { connectionId: "t", model: "main" }, cheap: { connectionId: "t", model: "cheap" } } };

const chapter = { title: "The Hollow", body: "Mira found a key under the old oak and ran home." };
const summary = "Mira finds a key.";

// ---- prompt ----
const req = summaryCheckRequest(8000, { chapter, summary });
ok(/Reply with JSON only/.test(req.system!) && req.system!.includes('{"ok":true}') && req.system!.includes('"problem"'), "system: JSON-only instruction with both answers");
ok(req.system!.includes("Minor wording or brevity is fine"), "system: brevity is fine");
ok(req.message.includes('Chapter: "The Hollow"') && req.message.includes("old oak") && req.message.includes("Summary to check:\nMira finds a key."), "chapter and summary appear in the prompt");
const long = "word ".repeat(30000);
const fitted = summaryCheckRequest(4000, { chapter: { title: "Long", body: long }, summary });
ok(fitted.message.length < long.length / 4 && fitted.message.includes("…") && fitted.message.includes(summary), "long chapter is fitted to the context, the summary kept");
ok(!summaryCheckRequest(4000, { chapter, summary }).message.includes("…"), "short chapter is left whole");

// ---- parseSummaryCheck ----
ok(JSON.stringify(parseSummaryCheck({ ok: true })) === '{"ok":true}', "ok true");
ok(JSON.stringify(parseSummaryCheck({ ok: "true" })) === '{"ok":true}', "ok as the string true");
ok(JSON.stringify(parseSummaryCheck(" OK. ")) === '{"ok":true}', "a bare ok");
const bad = parseSummaryCheck({ ok: false, problem: "  Leaves out\nthe   fire. " });
ok(bad !== null && !bad.ok && bad.problem === "Leaves out the fire.", "problem tidied");
const clipped = parseSummaryCheck({ ok: false, problem: "x".repeat(500) });
ok(clipped !== null && !clipped.ok && clipped.problem.length === 200, "problem cut to 200 characters");
const noProblem = parseSummaryCheck({ ok: false });
ok(noProblem !== null && !noProblem.ok && noProblem.problem.length > 0, "a missing problem gets a plain one");
ok(parseSummaryCheck({}) === null && parseSummaryCheck(null) === null && parseSummaryCheck(5) === null && parseSummaryCheck("maybe") === null, "junk -> null");

// ---- summaryCheck ----
reply = '{"ok":true}';
let r = await summaryCheck(settings, { chapter, summary });
ok(r.ok === true && prompts.length === 1, "ok reply");
ok(prompts[0].model === "cheap", "uses the cheap model by default");
await summaryCheck(settings, { chapter, summary, role: "main" });
ok(prompts[1].model === "main", "the role can be changed");
reply = 'Sure! ```json\n{"ok":false,"problem":"Leaves out that she ran home."}\n```';
r = await summaryCheck(settings, { chapter, summary });
ok(!r.ok && r.problem === "Leaves out that she ran home.", "problem reply, JSON found inside the text");
reply = "I cannot tell";
try { await summaryCheck(settings, { chapter, summary }); ok(false, "should throw"); } catch (e) { ok(/anything|JSON|summary/.test((e as Error).message), "unreadable reply -> error"); }
const ctl = new AbortController(); ctl.abort();
try { await summaryCheck(settings, { chapter, summary, signal: ctl.signal }); ok(false, "should abort"); } catch (e) { ok((e as any).name === "AbortError", "aborts"); }

server.close();
