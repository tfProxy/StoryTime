// The Illustrate page's prompt boxes, kept per chapter and moment: saving, reading back, and what is refused.
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

const full = { prompt: "a lighthouse, “storm”", negative: "blurry", scene: "The keeper climbs.", direction: "the lamp [close-up]", refs: [{ source: "saved:abc:header", label: "Header", role: "place", weight: 0.4 }], moment: "end" };
const { moment: _m, ...fullBoxes } = full;
const empty = { prompt: "", negative: "", scene: "", direction: "", refs: [] };
r = await call("PUT", url(one), full);
ok(r.status === 200 && r.json.ok === true, "the prompt boxes can be saved");
r = await call("GET", url(one));
ok(JSON.stringify(r.json.draft) === JSON.stringify({ moment: "end", start: empty, end: fullBoxes }), "…and are read back as saved, quotes and all, under their moment, the other moment empty");
ok((await call("GET", url(two))).json.draft === null, "…for that chapter only");

r = await call("PUT", url(one), { prompt: "only a prompt" });
r = await call("GET", url(one));
const onlyStart = { ...empty, prompt: "only a prompt" };
ok(JSON.stringify(r.json.draft) === JSON.stringify({ moment: "start", start: onlyStart, end: fullBoxes }), "saving the other moment keeps the first one's boxes; a missing field is saved empty, the moment is start, and it is now the current one");
await call("PUT", url(one), { ...full, prompt: "end again" });
r = await call("GET", url(one));
ok(r.json.draft.moment === "end" && r.json.draft.end.prompt === "end again" && r.json.draft.start.prompt === "only a prompt", "saving a moment again replaces its boxes and makes it the current one");
await call("PUT", url(one), { prompt: "only a prompt" });

r = await call("PUT", url(one), { ...full, moment: "middle" });
ok(r.status === 400 && /moment/.test(r.json.error), "a moment other than start or end is refused");
r = await call("PUT", url(one), { ...full, prompt: "x".repeat(20001) });
ok(r.status === 400 && /prompt/.test(r.json.error), "a prompt longer than 20,000 characters is refused");
r = await call("PUT", url(one), { ...full, direction: "x".repeat(201) });
ok(r.status === 400, "…as is a What to show longer than 200");
r = await call("PUT", url(one), { ...full, refs: Array.from({ length: 5 }, () => full.refs[0]) });
ok(r.status === 400, "…as are more than four references");
r = await call("PUT", url(one), { ...full, refs: [{ source: "saved:abc:header", label: "Header", role: "monster", weight: 0.4 }] });
ok(r.status === 400, "…and a reference with an unknown role");
r = await fetch(B + url(one), { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{ not json" });
ok(r.status === 400, "a body that isn't JSON is refused");
r = await call("GET", url(one));
ok(r.json.draft.moment === "start" && r.json.draft.start.prompt === "only a prompt" && r.json.draft.end.prompt === "end again", "…and none of those changed what was saved");

r = await call("PUT", url("no-such-chapter"), full);
ok(r.status === 404, "saving for a chapter that doesn't exist is refused");
ok((await call("GET", url("no-such-chapter"))).json.draft === null, "…and reading one gives nothing");
