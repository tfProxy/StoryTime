// The Illustrate page's prompt boxes, kept per chapter: saving, reading back, and what is refused.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const made = await call("POST", "/api/stories", { title: "Drafts", chapter: { title: "One", body: "first", choices: ["Next"] } });
const one = made.json.chapter_id;
const two = (await call("POST", "/api/chapters", { choice_id: (await call("GET", `/api/chapters/${one}`)).json.choices[0].id, title: "Two", body: "second" })).json.chapter_id;
const url = (id) => `/api/chapters/${id}/picture-draft`;

let r = await call("GET", url(one));
ok(r.status === 200 && r.json.draft === null, "a chapter has no saved prompt until one is saved");

const full = { prompt: "a lighthouse, “storm”", negative: "blurry", scene: "The keeper climbs.", direction: "the lamp [close-up]", moment: "end" };
r = await call("PUT", url(one), full);
ok(r.status === 200 && r.json.ok === true, "the prompt boxes can be saved");
r = await call("GET", url(one));
ok(JSON.stringify(r.json.draft) === JSON.stringify(full), "…and are read back as saved, quotes and all");
ok((await call("GET", url(two))).json.draft === null, "…for that chapter only");

r = await call("PUT", url(one), { prompt: "only a prompt" });
r = await call("GET", url(one));
ok(JSON.stringify(r.json.draft) === JSON.stringify({ prompt: "only a prompt", negative: "", scene: "", direction: "", moment: "start" }), "saving again replaces them; a missing field is saved empty, and the moment is start");

r = await call("PUT", url(one), { ...full, moment: "middle" });
ok(r.status === 400 && /moment/.test(r.json.error), "a moment other than start or end is refused");
r = await call("PUT", url(one), { ...full, prompt: "x".repeat(20001) });
ok(r.status === 400 && /prompt/.test(r.json.error), "a prompt longer than 20,000 characters is refused");
r = await call("PUT", url(one), { ...full, direction: "x".repeat(201) });
ok(r.status === 400, "…as is a What to show longer than 200");
r = await fetch(B + url(one), { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{ not json" });
ok(r.status === 400, "a body that isn't JSON is refused");
ok((await call("GET", url(one))).json.draft.prompt === "only a prompt", "…and none of those changed what was saved");

r = await call("PUT", url("no-such-chapter"), full);
ok(r.status === 404, "saving for a chapter that doesn't exist is refused");
ok((await call("GET", url("no-such-chapter"))).json.draft === null, "…and reading one gives nothing");
