// Basic story / chapter / choice behaviour through the HTTP API.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

let r = await call("POST", "/api/stories", { title: "Test Tale", premise: "p", author_name: "Ann", chapter: { title: "Ch1", body: "Once upon.\n\nA time.", choices: ["Go left", "Go right"] } });
ok(r.status === 201 && r.json.story_id && r.json.chapter_id, "create story");
const { story_id: story, chapter_id: root } = r.json;
let g = await call("GET", `/api/chapters/${root}`);
ok(g.json.choices.length === 2 && g.json.choices.every((c) => c.child_chapter_id === null), "choices start unwritten");
const [left, right] = g.json.choices;

r = await call("POST", "/api/chapters", { title: "Left", body: "You went left", author_name: "Bob", choice_id: left.id, choices: ["Hop"] });
ok(r.status === 201, "fill an unwritten choice");
const leftCh = r.json.chapter_id;
r = await call("POST", "/api/chapters", { title: "Left2", body: "x", choice_id: left.id });
ok(r.status === 409, "first poster wins: " + r.json?.error);
r = await call("POST", "/api/chapters", { title: "Up", body: "up", parent_chapter_id: root, new_choice_label: "Climb" });
ok(r.status === 201, "add a new choice with its chapter");
g = await call("GET", `/api/chapters/${root}`);
ok(g.json.choices.length === 3 && g.json.choices.filter((c) => c.child_chapter_id).length === 2 && g.json.choices[1].id === right.id && g.json.choices[1].child_chapter_id === null, "choices reflect fills");

g = await call("GET", `/api/chapters/${leftCh}`);
ok(g.json.path.map((c) => c.title).join() === "Ch1,Left" && g.json.chapter.depth === 1, "path runs from the root");

r = await call("POST", "/api/chapters", { title: "x", body: "y" });
ok(r.status === 400, "needs a choice or a parent");
r = await call("POST", "/api/chapters", { title: "x", body: "y", choice_id: "nope" });
ok(r.status === 404, "unknown choice 404");
r = await call("POST", "/api/stories", { title: "", chapter: { title: "a", body: "b" } });
ok(r.status === 400, "empty story title rejected");
r = await call("POST", "/api/stories", { title: "T", chapter: { title: "a", body: "b", choices: Array(13).fill("c") } });
ok(r.status === 400, "too many choices rejected");
r = await call("POST", "/api/stories", { title: "T", chapter: { title: "a", body: "b".repeat(50001) } });
ok(r.status === 400, "oversized chapter rejected");
const bad = await fetch(B + "/api/stories", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
ok(bad.status === 400, "invalid JSON rejected");

ok((await call("GET", "/api/stories")).json.some((s) => s.id === story && s.chapter_count === 3), "story listed with chapter count");
for (const u of ["/", "/new", "/settings", "/drafts", `/s/${story}`, `/c/${root}`, `/c/${root}/write`, `/c/${root}/write?choice=${right.id}`, `/c/${root}/codex`, `/c/${root}/history`]) {
  const x = await fetch(B + u); ok(x.status === 200, `${u} -> ${x.status}`);
}
ok((await fetch(`${B}/c/nope`)).status === 404, "unknown chapter page 404");
ok(!(await (await fetch(`${B}/c/${root}`)).text()).includes("<script>alert"), "pages render text safely");
const xss = await call("POST", "/api/stories", { title: "<script>alert(1)</script>", chapter: { title: "<img src=x onerror=alert(1)>", body: "<b>hi</b>" } });
const page = await (await fetch(`${B}/c/${xss.json.chapter_id}`)).text();
ok(!page.includes("<img src=x") && !page.includes("<b>hi</b>") && page.includes("&lt;b&gt;hi&lt;/b&gt;"), "chapter text is escaped, not injected");
