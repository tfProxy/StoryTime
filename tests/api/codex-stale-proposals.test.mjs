// New-entry proposals in the codex inbox: one already waiting at this chapter or an earlier one isn't saved again, and
// waiting ones close once the codex has the entry at their chapter (added by hand, renamed, or another one accepted).
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const s = await call("POST", "/api/stories", { title: "Proposals", premise: "P", chapter: { title: "Root", body: "Denise woke.", summary: "s", choices: ["Go", "Stay"] } });
const story = s.json.story_id;
const root = s.json.chapter_id;
try {
  const [go, stay] = (await call("GET", `/api/chapters/${root}`)).json.choices;
  const chapter = async (choice, title, body) => {
    const id = (await call("POST", "/api/chapters", { choice_id: choice, title, body, summary: "s", choices: ["On"] })).json.chapter_id;
    return { id, next: (await call("GET", `/api/chapters/${id}`)).json.choices[0]?.id };
  };
  const c1 = await chapter(go.id, "Lily arrives", "Lily the student knocked.");
  const c2 = await chapter(c1.next, "Lily again", "Lily laughed.");
  const side = await chapter(stay.id, "Elsewhere", "Lily waved from the bus.");
  const lily = (quote, aliases = []) => ({ kind: "entry", entry: { name: "Lily", type: "character", aliases, notes: "A student.", facts: [{ aspect: "Occupation", form: "", text: "Student." }] }, quote });
  const post = (c, list) => call("POST", `/api/chapters/${c}/codex-suggestions`, { revision: 1, suggestions: list });
  const open = async () => (await call("GET", `/api/stories/${story}/codex-suggestions?status=open`)).json.suggestions.filter((x) => x.kind === "entry");

  ok((await post(c1.id, [lily("Lily the student knocked", ["the student"])])).json.saved === 1, "a new entry is proposed at the chapter where it appears");
  ok((await post(c2.id, [lily("Lily laughed")])).json.saved === 0, "…and not again at a later chapter while that proposal waits");
  ok((await post(side.id, [lily("Lily waved from the bus")])).json.saved === 1, "…but it is on another branch, which the first proposal doesn't reach");
  ok((await open()).length === 2, "two proposals wait");

  // The owner adds Lily by hand at the root: every waiting proposal below it is closed.
  const made = await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Lily", type: "character" });
  ok(made.status === 201, "an entry added by hand: " + made.status);
  ok((await open()).length === 0, "…closes the proposals of it that were waiting");
  const closed = (await call("GET", `/api/stories/${story}/codex-suggestions?status=dismissed`)).json.suggestions.filter((x) => x.kind === "entry");
  ok(closed.length === 2, "…as dismissed");

  // An alias counts: a proposal of "Brin" closes when an entry called Brindle gets the alias.
  const brin = { kind: "entry", entry: { name: "Brin", type: "character", aliases: [], notes: "A fox.", facts: [{ aspect: "Species", form: "", text: "Fox." }] }, quote: "Lily laughed" };
  ok((await post(c2.id, [brin])).json.saved === 1, "a proposal of Brin waits");
  const brindle = (await call("POST", "/api/codex", { anchor_chapter_id: c1.id, op: "create", name: "Brindle", type: "character" })).json.entry_id;
  ok((await open()).length === 1, "an entry of another name leaves it waiting");
  await call("POST", "/api/codex", { anchor_chapter_id: c1.id, op: "replace", entry_id: brindle, name: "Brindle", type: "character", aliases: ["Brin"] });
  ok((await open()).length === 0, "…and giving that entry the alias Brin closes it");
} finally {
  await call("DELETE", `/api/stories/${story}`);
}
