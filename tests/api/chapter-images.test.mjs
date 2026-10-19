// Chapter illustrations: a header and a footer picture per chapter. Upload, fetch, replace and remove, and what is refused.
const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const json = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const url = (id, slot) => `${B}/api/chapters/${id}/images/${slot}`;
const put = (id, slot, bytes, type = "image/png") => fetch(url(id, slot), { method: "PUT", headers: { "Content-Type": type }, body: bytes });
const get = (id, slot, headers) => fetch(url(id, slot), { headers });
const del = (id, slot) => fetch(url(id, slot), { method: "DELETE" });

// a 1x1 PNG, and the first bytes of a JPEG
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

const chapter = (await json("POST", "/api/stories", { title: "Illustrated", chapter: { title: "Root", body: "b" } })).json.chapter_id;
ok((await get(chapter, "header")).status === 404 && (await get(chapter, "footer")).status === 404, "a new chapter has no pictures");

let r = await put(chapter, "header", png);
const first = (await r.json()).version;
ok(r.status === 200 && typeof first === "number", "uploading a PNG works and returns its version");
r = await get(chapter, "header");
ok(r.status === 200 && r.headers.get("content-type") === "image/png" && Buffer.from(await r.arrayBuffer()).equals(png), "the picture comes back as uploaded");
ok(r.headers.get("x-content-type-options") === "nosniff", "…marked so browsers don't guess its type");
ok((await get(chapter, "header", { "If-None-Match": r.headers.get("etag") })).status === 304, "…and isn't sent again when unchanged");
ok((await get(chapter, "footer")).status === 404, "the other slot is still empty");

r = await put(chapter, "header", jpeg, "application/octet-stream");
const second = (await r.json()).version;
ok(r.status === 200 && second > first, "replacing it gives a new version, whatever type the upload claims");
r = await get(chapter, "header");
ok(r.headers.get("content-type") === "image/jpeg" && Buffer.from(await r.arrayBuffer()).equals(jpeg), "…and the type comes from the file itself");

// the two slots don't affect each other
r = await put(chapter, "footer", png);
ok(r.status === 200 && (await get(chapter, "footer")).headers.get("content-type") === "image/png", "the footer takes its own picture");
ok((await get(chapter, "header")).headers.get("content-type") === "image/jpeg", "…and the header is unchanged");

// what is refused leaves the previous picture alone
ok((await put(chapter, "header", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml")).status === 415, "an SVG is refused");
ok((await put(chapter, "header", Buffer.from("not an image"), "image/png")).status === 415, "so is a file that only says it is an image");
ok((await put(chapter, "header", Buffer.alloc(0))).status === 400, "an empty upload is refused");
ok((await put(chapter, "header", Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]))).status === 413, "a picture over 4 MB is refused");
r = await get(chapter, "header");
ok(r.headers.get("content-type") === "image/jpeg" && Buffer.from(await r.arrayBuffer()).equals(jpeg), "…leaving the header as it was");

ok((await put("nope", "header", png)).status === 404, "a chapter that doesn't exist can't be given a picture");
ok((await del("nope", "header")).status === 404, "removing one from a chapter that doesn't exist is a 404");
ok((await put(chapter, "middle", png)).status === 404 && (await get(chapter, "middle")).status === 404 && (await del(chapter, "middle")).status === 404, "a slot other than header or footer is a 404");

r = await del(chapter, "header");
ok(r.status === 200 && (await r.json()).ok === true && (await get(chapter, "header")).status === 404, "removing the header empties the slot");
ok((await get(chapter, "footer")).status === 200, "…and the footer is kept");
ok((await del(chapter, "header")).status === 200, "removing an empty slot is harmless");
ok((await del(chapter, "footer")).status === 200 && (await get(chapter, "footer")).status === 404, "the footer can be removed too");
