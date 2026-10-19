// Story cover images: upload, fetch, replace and remove, and what is refused.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const json = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const put = (id, bytes, type = "image/png") => fetch(`${B}/api/stories/${id}/cover`, { method: "PUT", headers: { "Content-Type": type }, body: bytes });

// a 1x1 PNG, and the first bytes of a JPEG and a GIF
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

const story = (await json("POST", "/api/stories", { title: "Covered", chapter: { title: "Root", body: "b" } })).json.story_id;
ok((await json("GET", `/api/stories/${story}`)).json.cover_version === null, "a new story has no cover");
ok((await fetch(`${B}/api/stories/${story}/cover`)).status === 404, "…so fetching its cover is a 404");
ok((await json("GET", "/api/stories")).json.find((s) => s.id === story)?.cover_version === null, "…and the list says so");

let r = await put(story, png);
const first = (await r.json()).cover_version;
ok(r.status === 200 && typeof first === "number", "uploading a PNG works and returns its version");
r = await fetch(`${B}/api/stories/${story}/cover`);
ok(r.status === 200 && r.headers.get("content-type") === "image/png" && Buffer.from(await r.arrayBuffer()).equals(png), "the cover comes back as uploaded");
ok(r.headers.get("x-content-type-options") === "nosniff", "…marked so browsers don't guess its type");
ok((await fetch(`${B}/api/stories/${story}/cover`, { headers: { "If-None-Match": r.headers.get("etag") } })).status === 304, "…and isn't sent again when unchanged");
ok((await json("GET", `/api/stories/${story}`)).json.cover_version === first, "the story and the list carry the version");

r = await put(story, jpeg, "application/octet-stream");
const second = (await r.json()).cover_version;
ok(r.status === 200 && second > first, "replacing it gives a new version, whatever type the upload claims");
ok((await fetch(`${B}/api/stories/${story}/cover`)).headers.get("content-type") === "image/jpeg", "…and the type comes from the file itself");

ok((await put(story, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml")).status === 415, "an SVG is refused");
ok((await put(story, Buffer.from("not an image"), "image/png")).status === 415, "so is a file that only says it is an image");
ok((await put(story, Buffer.alloc(0))).status === 400, "an empty upload is refused");
ok((await put(story, Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]))).status === 413, "a cover over 4 MB is refused");
ok((await fetch(`${B}/api/stories/${story}/cover`)).headers.get("content-type") === "image/jpeg", "…leaving the cover as it was");
ok((await put("nope", png)).status === 404, "a story that doesn't exist can't be given a cover");

r = await fetch(`${B}/api/stories/${story}/cover`, { method: "DELETE" });
ok(r.status === 200 && (await fetch(`${B}/api/stories/${story}/cover`)).status === 404, "removing the cover works");
ok((await json("GET", `/api/stories/${story}`)).json.cover_version === null, "…and the story has no cover again");
ok((await fetch(`${B}/api/stories/nope/cover`, { method: "DELETE" })).status === 404, "removing one from a story that doesn't exist is a 404");
