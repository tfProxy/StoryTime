// Generate on the server: the request is kept as a waiting item; running it streams the chapter into the draft, then
// the choice text and suggested choices; Stop keeps the text so far; a failure marks the item and says why.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeAi } from "../fakeAi.mjs";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytime-generate-"));
process.env.STORYTIME_DB = path.join(dir, "generate.db");
const { db } = await import("../../src/lib/db.ts");
const { putSettings } = await import("../../src/lib/settingsStore.ts");
const { DEFAULT_SETTINGS } = await import("../../src/lib/settingsSchema.ts");
const { SYSTEM_CHOICE_LABEL, SYSTEM_CHOICES } = await import("../../src/lib/ai/prompts.ts");
const { subscribe } = await import("../../src/lib/worker/bus.ts");
const { getItem } = await import("../../src/lib/worker/items.ts");
const { generateProgress, genChannel, genItemKey, generateRequest, runGenerate, startGenerate, stopGenerate } = await import("../../src/lib/worker/generate.ts");
const { getDraft, putDraft } = await import("../../src/lib/draftStore.ts");

const chapter = "# The Door\n\nShe opened it and went in.";
const ai = await startFakeAi({
  port: 3558,
  delay: 5,
  reply: (body: { stream?: boolean }) => {
    const sent = JSON.stringify(body);
    if (sent.includes(SYSTEM_CHOICES)) return '["Go left", "Go right"]';
    if (sent.includes(SYSTEM_CHOICE_LABEL)) return "Open the door.";
    return chapter;
  },
});

const request = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  href: `/stories/s1/chapters/c1/write`,
  label: "A chapter",
  ctx: { storyTitle: "Story", premise: "p", path: [] },
  direction: "go on",
  length: "short" as const,
  model: null,
  suggestModel: null,
  after: { choiceText: true, suggestChoices: true },
  base: { title: "", body: "" },
  draft: { key, href: "/stories/s1/chapters/c1/write", label: "A chapter", updatedAt: 0, storyTitle: "", premise: "", newChoiceLabel: "", title: "", body: "", choices: [""], prompt: "", undo: [] },
  ...extra,
});
const watch = (key: string) => {
  const events: { type: string; text?: string; message?: string; after?: { choiceLabel?: string; suggestions?: string[] } }[] = [];
  const stop = subscribe(genChannel(key), (e) => events.push(e as never));
  return { events, stop };
};

try {
  db();

  // Asking.
  const bad = generateRequest.safeParse({ ...request("fill:x"), length: "huge" });
  ok(!bad.success, "a request with an unknown length is refused");
  ok(!generateRequest.safeParse({ ...request("fill:x"), ctx: undefined }).success, "…and one with no story");
  ok(!generateRequest.safeParse({ ...request("fill:x"), ctx: { big: "x".repeat(4_100_000) } }).success, "…and one with too large a story");
  const item = startGenerate(generateRequest.parse(request("fill:a")));
  ok(item.key === "gen:fill:a" && item.state === "waiting" && item.data.draftKey === "fill:a" && item.data.label === "A chapter", "a Generate is kept as a waiting item named gen:<draft key>");
  ok(startGenerate(generateRequest.parse(request("fill:a"))).createdAt === item.createdAt, "asking again while it waits changes nothing");
  ok(stopGenerate("fill:a") && getItem(genItemKey("fill:a")) === null, "stopping a waiting Generate removes it");
  ok(!stopGenerate("fill:a"), "…and there is then nothing to stop");

  // No settings yet: no model chosen. The item fails and says so.
  startGenerate(generateRequest.parse(request("fill:nomodel")));
  const lost = watch("fill:nomodel");
  await runGenerate("fill:nomodel");
  lost.stop();
  const failed = getItem(genItemKey("fill:nomodel"));
  ok(failed?.state === "failed" && /No model is chosen/.test(failed.data.error ?? ""), `with no model chosen the item fails with the reason (${failed?.data.error})`);
  ok(lost.events.at(-1)?.type === "error" && /No model/.test(lost.events.at(-1)?.message ?? ""), "…and the watchers are told");
  ok(getDraft("fill:nomodel") === null, "…and no draft is made from nothing");

  putSettings({
    ...DEFAULT_SETTINGS,
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
  });

  // A whole Generate.
  startGenerate(generateRequest.parse(request("fill:b", { base: { title: "Old", body: "Old text" }, draft: { ...request("fill:b").draft, title: "Old", body: "Old text" } })));
  const seen = watch("fill:b");
  const running = runGenerate("fill:b");
  ok(getItem("gen:fill:b")?.state === "working", "a Generate that runs is working");
  await running;
  seen.stop();
  const done = getItem("gen:fill:b");
  ok(done?.state === "done" && done.endedAt !== null, "…and done when it finishes");
  const texts = seen.events.filter((e) => e.type === "text").map((e) => e.text ?? "");
  ok(texts.length >= 3 && texts[0] !== chapter && texts.at(-1) === chapter, `its text is published piece by piece (${texts.length} times)`);
  ok(seen.events.at(-1)?.type === "done" && seen.events.at(-1)?.after?.choiceLabel === "Open the door" && seen.events.at(-1)?.after?.suggestions?.join() === "Go left,Go right", "…then the end, with the choice text and the suggestions");
  const draft = getDraft("fill:b") as { title: string; body: string; undo: { title: string; body: string }[]; newChoiceLabel: string; suggestions: string[]; versions: unknown[] } | null;
  ok(draft?.title === "The Door" && draft.body === "She opened it and went in.", "the chapter is in the draft");
  ok(draft?.undo.length === 1 && draft.undo[0].body === "Old text", "…the text it replaced kept once, as the undo");
  ok(draft?.newChoiceLabel === "Open the door" && draft.suggestions.join() === "Go left,Go right", "…with the choice text and the suggested choices");
  ok(generateProgress("fill:b") === null, "nothing is going once it ends");
  const asked = ai.requests.filter((r: { body: unknown }) => !JSON.stringify(r.body).includes("You help write branching stories"));
  ok(asked.length >= 1 && ai.requests.length === asked.length + 2, "the chapter was asked for, then the choice text and the choices, once each");
  startGenerate(generateRequest.parse(request("fill:b")));
  ok(getItem("gen:fill:b")?.state === "waiting", "asking again after it finished starts a new one");
  stopGenerate("fill:b");

  // A draft the page saved meanwhile is built on, not overwritten.
  putDraft("fill:c", { ...request("fill:c").draft, prompt: "typed while waiting" }, { base: null });
  startGenerate(generateRequest.parse(request("fill:c")));
  await runGenerate("fill:c");
  const kept = getDraft("fill:c") as { prompt: string; body: string } | null;
  ok(kept?.prompt === "typed while waiting" && kept.body === "She opened it and went in.", "a draft saved on the server is the one the text goes into");

  // Stop keeps the text so far.
  ai.setDelay(150);
  startGenerate(generateRequest.parse(request("fill:d")));
  const stopping = watch("fill:d");
  const going = runGenerate("fill:d");
  while (!stopping.events.some((e) => e.type === "text")) await new Promise((r) => setTimeout(r, 10));
  ok(generateProgress("fill:d")?.type === "text" && (generateProgress("fill:d") as { text: string }).text.length > 0, "a page that joins a Generate that is going is sent its text so far");
  ok(stopGenerate("fill:d"), "a Generate that is going can be stopped");
  await going;
  stopping.stop();
  const partial = getDraft("fill:d") as { body: string; title: string } | null;
  ok(getItem("gen:fill:d") === null, "a stopped Generate is removed");
  ok(!!partial && partial.body.length > 0 && partial.body.length < "She opened it and went in.".length, `…and the text so far stays in the draft (${JSON.stringify(partial?.body)})`);

  // A Generate that was going when the server stopped (D12).
  const { createItem } = await import("../../src/lib/worker/items.ts");
  const { recoverGenerates } = await import("../../src/lib/worker/loop.ts");
  createItem({ key: "gen:fill:z", type: "generate", state: "working", data: { draftKey: "fill:z", href: "/", label: "Z", request: {} } });
  recoverGenerates();
  const restarted = getItem("gen:fill:z");
  ok(restarted?.state === "failed" && /restarted while writing/.test(restarted.data.error ?? ""), "after a restart, a Generate that was going is failed, with the reason");

  // A run step that was going goes back in line (D12).
  const { recoverRuns } = await import("../../src/lib/worker/runs.ts");
  createItem({ key: "run:r1", type: "run", state: "working", data: { runId: "r1", storyId: "s", storyTitle: "S", startChapterId: null, startTitle: "", mode: "fill", done: 0, total: 2 } });
  recoverRuns();
  ok(getItem("run:r1")?.state === "waiting", "after a restart, a run that was working goes back in line");
} finally {
  await ai.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
