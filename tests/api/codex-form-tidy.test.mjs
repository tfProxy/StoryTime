// Facts the AI saved before forms were cleaned ("Lizard Woman form", or the form inside the aspect) are read as the plain
// form, so they join the real form instead of making a second one.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => { const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

const r = await call("POST", "/api/stories", { title: "Tidy forms", chapter: { title: "Root", body: "r" } });
const root = r.json.chapter_id;
const sylvia = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Sylvia", type: "character" })).json.entry_id;
const fact = (aspect, text, form) => call("POST", "/api/codex/facts", { anchor_chapter_id: root, entry_id: sylvia, op: "set", aspect, form, text });
const f1 = await fact("Skin", "Green scales.", "Lizard Woman form");
const f2 = await fact("Eyes [Lizard Woman form]", "Slit pupils.", "");
const f3 = await fact("form", "", "Lizard Woman");
ok(f1.status === 201 && f2.status === 201 && f3.status === 201, "the facts API saves them as given: " + [f1.status, f2.status, f3.status]);

const e = (await call("GET", `/api/chapters/${root}/codex`)).json.entries.find((x) => x.entry_id === sylvia);
const skin = e.facts.find((f) => f.fact_id === f1.json.fact_id);
const eyes = e.facts.find((f) => f.fact_id === f2.json.fact_id);
ok(skin?.form === "Lizard Woman" && skin.aspect === "Skin", "\"Lizard Woman form\" is read as the form \"Lizard Woman\": " + JSON.stringify(skin));
ok(eyes?.form === "Lizard Woman" && eyes.aspect === "Eyes", "\"Eyes [Lizard Woman form]\" is read as aspect Eyes, form Lizard Woman: " + JSON.stringify(eyes));
ok(e.form?.name === "Lizard Woman", "the entry is in Lizard Woman: " + JSON.stringify(e.form));
ok(e.description.includes("Green scales.") && e.description.includes("Slit pupils."), "the AI reads both facts while in that form: " + e.description);
ok(e.forms.filter((n) => n.toLowerCase() === "lizard woman").length === 1 && e.forms.length === 1, "one form is listed: " + JSON.stringify(e.forms));
