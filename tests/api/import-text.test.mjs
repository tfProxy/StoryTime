// Importing a story from text, through the queue and the fake AI: the breaks, the other choices and the story's details
// end up in the import's draft; Create makes one chain of chapters joined by the original choices (marked original),
// with the kept suggestions as unwritten choices; the switch and the JSON export keep the original path.
import Database from "better-sqlite3";
import { startFakeAi } from "../fakeAi.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > stop) return null;
    await sleep(50);
  }
};

// Twelve paragraphs of 40 words; the fake AI breaks after paragraphs 4 and 8.
const para = (n) => `Paragraph ${n} ${"sand ".repeat(38).trim()}`;
const text = `# The Salt Road\n\n${Array.from({ length: 12 }, (_, i) => para(i + 1)).join("\n\n")}`;

let splitAsks = 0;
const ai = await startFakeAi({
  port: 3561,
  delay: 1,
  reply: (body) => {
    const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
    if (system.includes("divide it into short chapters")) {
      splitAsks++;
      // The first answer can't be read: the import asks once more.
      if (splitAsks === 1) return "Sorry, I am not sure.";
      return JSON.stringify([
        { end: 4, title: "Dust", choice: "Ask Dace about the wells" },
        { end: 8, title: "Lights", choice: "Slip away to the lights" },
        { end: 12, title: "Home", choice: "" },
      ]);
    }
    if (system.includes("other choices the main character could have made")) {
      const user = body.messages.find((m) => m.role === "user").content;
      return user.includes("original story ends") ? '["Look back at the flats", "Stay on the flats"]' : '["Ask Dace about the wells", "Wake the guards", "Run"]';
    }
    if (system.includes("set up a story")) return '{"premise": "A girl on a salt caravan.", "style": "Close third person, past tense."}';
    return "?";
  },
});

const settingsBefore = (await call("GET", "/api/settings")).json.settings;
let storyId = null;
let importId = null;
try {
  await call("PUT", "/api/settings", {
    ...(settingsBefore ?? {}),
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k", freeComfy: false, freeForPictures: false }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
    autoCodex: false,
  });
  const options = { minWords: 100, maxWords: 200, alternatives: 2, model: null };

  let r = await call("POST", "/api/import-text", { text: "  \n\n ", options });
  ok(r.status === 400 && /no story text/.test(r.json.error), "an empty text is refused");
  r = await call("POST", "/api/import-text", { text, options: { ...options, maxWords: 100 } });
  ok(r.status === 400, "…as is a longest chapter no longer than the shortest");

  r = await call("POST", "/api/import-text", { text, options });
  ok(r.status === 201 && /^\/new\/import\/[\w-]+$/.test(r.json.href) && r.json.key.startsWith("import:"), "an import starts and says where its page is");
  importId = r.json.key.slice("import:".length);
  const drafts = (await call("GET", "/api/drafts")).json.drafts;
  ok(drafts.some((d) => d.key === r.json.key && d.href === r.json.href && d.label === "Import: The Salt Road"), "…and is listed under Drafts");

  const done = await until(async () => {
    const g = await call("GET", `/api/import-text/${importId}`);
    return g.json?.draft?.status === "ready" ? g.json : null;
  });
  ok(!!done, "the queue splits the story");
  const plan = done?.draft.plan;
  ok(done?.queued === null, "…and is done with it");
  ok(splitAsks === 2, "an answer that can't be read is asked again: " + splitAsks);
  ok(JSON.stringify(plan?.chapters.map((c) => c.start)) === "[0,4,8]" && plan.chapters.map((c) => c.title).join() === "Dust,Lights,Home", "three chapters at the AI's breaks");
  ok(plan?.chapters[0].choice === "Ask Dace about the wells" && plan.chapters[2].choice === "", "the original choices; none after the last chapter");
  ok(JSON.stringify(plan?.chapters[0].alternatives) === JSON.stringify([{ label: "Wake the guards", keep: true }, { label: "Run", keep: true }]), "other choices, without the original one, as many as asked for");
  ok(plan?.chapters[2].alternatives.map((a) => a.label).join() === "Look back at the flats,Stay on the flats", "other endings after the last chapter");
  ok(plan?.title === "The Salt Road" && plan.premise === "A girl on a salt caravan." && plan.style.startsWith("Close third"), "the title from the text, the summary and style notes from the AI");

  // The review drops one suggestion before creating the story (the page saves the draft the same way).
  const draft = done.draft;
  draft.plan.chapters[0].alternatives[1].keep = false;
  r = await call("PUT", `/api/drafts/${encodeURIComponent(draft.key)}`, { draft, base: draft.updatedAt });
  ok(r.status === 200, "the review's changes are saved into the draft");

  r = await call("POST", `/api/import-text/${importId}/create`);
  ok(r.status === 201 && r.json.story_id && r.json.chapter_id, "Create makes the story");
  storyId = r.json.story_id;
  ok((await call("GET", `/api/import-text/${importId}`)).status === 404, "…and the import's draft is gone");
  ok((await call("POST", `/api/import-text/${importId}/create`)).status === 404, "…so it can't be made twice");

  const db = new Database(process.env.TEST_DB, { readonly: true });
  const story = db.prepare("SELECT title, premise, style, show_original FROM stories WHERE id = ?").get(storyId);
  ok(story.title === "The Salt Road" && story.premise === "A girl on a salt caravan." && story.show_original === 1, "the story has the details, and shows the original path");
  const chapters = db.prepare("SELECT id, title, body, depth, parent_choice_id FROM chapters WHERE story_id = ? ORDER BY depth").all(storyId);
  ok(chapters.length === 3 && chapters.map((c) => c.depth).join() === "0,1,2", "three chapters, one after another");
  ok(chapters[0].body === [1, 2, 3, 4].map(para).join("\n\n") && chapters[2].body.endsWith(para(12)), "each chapter is the original text, word for word");
  const choices = db.prepare("SELECT ch.label, ch.original, ch.parent_chapter_id, c.id AS child FROM choices ch LEFT JOIN chapters c ON c.parent_choice_id = ch.id WHERE ch.parent_chapter_id IN (?, ?, ?) ORDER BY ch.rowid").all(...chapters.map((c) => c.id));
  const of = (i) => choices.filter((c) => c.parent_chapter_id === chapters[i].id);
  ok(of(0).map((c) => `${c.label}:${c.original}:${c.child ? "written" : "open"}`).join("|") === "Ask Dace about the wells:1:written|Wake the guards:0:open", "the original choice leads on; a kept suggestion is unwritten, a dropped one is left out");
  ok(of(0)[0].child === chapters[1].id && of(1)[0].child === chapters[2].id, "…to the next chapter");
  ok(of(2).length === 2 && of(2).every((c) => c.original === 0 && !c.child), "the last chapter has the other endings, unwritten");
  db.close();

  const exported = JSON.parse(await (await fetch(`${B}/api/stories/${storyId}/export?format=json`)).text());
  ok(exported.choices.filter((c) => c.original).length === 2, "the JSON export keeps the original path");
  r = await call("POST", "/api/stories/import", exported);
  ok(r.status === 201, "…and importing it again works");
  const copy = r.json.story_id;
  const db2 = new Database(process.env.TEST_DB, { readonly: true });
  ok(db2.prepare("SELECT COUNT(*) AS n FROM choices ch JOIN chapters c ON c.id = ch.parent_chapter_id WHERE c.story_id = ? AND ch.original = 1").get(copy).n === 2, "…with the original path");
  db2.close();

  r = await call("PATCH", `/api/stories/${storyId}`, { show_original: false });
  ok(r.status === 200, "the switch can be turned off");
  const page = await (await fetch(`${B}/c/${chapters[0].id}`)).text();
  ok(page.includes("Show the original path") && !page.includes(">Original<"), "…the reading page offers it, with no marks while it is off");
  await call("PATCH", `/api/stories/${storyId}`, { show_original: true });
  ok((await (await fetch(`${B}/c/${chapters[0].id}`)).text()).includes(">Original<"), "…and marks the original choice when it is on");

  // Split again, then Discard.
  r = await call("POST", "/api/import-text", { text, options: { ...options, alternatives: 0 } });
  const second = r.json.key.slice("import:".length);
  await until(async () => (await call("GET", `/api/import-text/${second}`)).json?.draft?.status === "ready");
  r = await call("POST", `/api/import-text/${second}/split`, { options: { ...options, alternatives: 1 } });
  ok(r.status === 200, "an import can be split again");
  const again = await until(async () => {
    const g = await call("GET", `/api/import-text/${second}`);
    return g.json?.draft?.status === "ready" ? g.json.draft : null;
  });
  ok(again?.options.alternatives === 1 && again.plan.chapters[0].alternatives.length === 1, "…with the new options");
  ok((await call("DELETE", `/api/import-text/${second}`)).status === 200 && (await call("GET", `/api/import-text/${second}`)).status === 404, "Discard deletes the import");
} finally {
  await ai.close();
  if (importId) await call("DELETE", `/api/import-text/${importId}`);
  if (settingsBefore === null) {
    const db = new Database(process.env.TEST_DB);
    db.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    db.close();
  } else await call("PUT", "/api/settings", settingsBefore);
}
