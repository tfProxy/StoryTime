// Content notes under each choice: the offline HTML export includes them.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sfx = Math.random().toString(36).slice(2, 8);
const made = [];
const mk = async (name, extra = {}) => {
  const r = await call("POST", "/api/tags", { name: `${name}${sfx}`, applies: "when it happens", not_applies: "never", ...extra });
  made.push(r.json.id);
  return r.json;
};

try {
  const shown = await mk("viol", { show_readers: true, choices: ["graphic"] });
  const deep = await mk("deepnote", { show_readers: true });
  const hidden = await mk("secret");

  let r = await call("POST", "/api/stories", { title: "Notes", chapter: { title: "Root", body: "root", choices: ["Go"] } });
  const root = r.json.chapter_id;
  const c1 = (await call("GET", `/api/chapters/${root}`)).json.choices[0];
  const child = (await call("POST", "/api/chapters", { choice_id: c1.id, title: "Child", body: "child", choices: ["Further"] })).json.chapter_id;
  const c2 = (await call("GET", `/api/chapters/${child}`)).json.choices[0];
  const grand = (await call("POST", "/api/chapters", { choice_id: c2.id, title: "Grand", body: "grand" })).json.chapter_id;
  await call("POST", `/api/chapters/${child}/tags`, { tag_id: shown.id, value: "graphic" });
  await call("POST", `/api/chapters/${child}/tags`, { tag_id: hidden.id });
  await call("POST", `/api/chapters/${grand}/tags`, { tag_id: deep.id });

  const pages = async (id) => {
    const x = await (await fetch(`${B}/api/stories/${id}/export?format=html`)).text();
    return JSON.parse(/<script id="story-data" type="application\/json">([\s\S]*?)<\/script>/.exec(x)[1]).pages;
  };
  // The switch is on by default. (Turning it off is covered in the browser test: this suite must leave settings unsaved.)
  const p = await pages(r.json.story_id);
  ok(p[root].c[0][2] === `Next: viol${sfx} (graphic) · Later on this branch: deepnote${sfx}`, "the export puts the note on the choice: " + JSON.stringify(p[root].c[0]));
  ok(p[child].c[0][2] === `Next: deepnote${sfx}`, "…and only Next when nothing is further down");
  ok(p[child].c[0].length === 3 && !JSON.stringify(p).includes(`secret${sfx}`), "…a tag not marked Show to readers is left out");
} finally {
  for (const id of made) await call("DELETE", `/api/tags/${id}`);
}
