// The queue's pause switch, pictures sent by the browser for a job, and the server fetching every kind of picture source
// (through the test-only /api/queue/test-resolve, which answers what resolveSource returns).
import Database from "better-sqlite3";
import { startFakeComfy, makePng } from "../e2e/fakeComfy.mjs";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const call = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const resolve = async (source) => {
  const r = await fetch(`${B}/api/queue/test-resolve?source=${encodeURIComponent(source)}`);
  const type = r.headers.get("content-type");
  return r.ok ? { ok: true, type, bytes: Buffer.from(await r.arrayBuffer()) } : { ok: false, status: r.status, message: (await r.json()).error };
};
const send = (bytes, type = "image/png") => fetch(`${B}/api/queue/uploads`, { method: "POST", headers: { "Content-Type": type }, body: bytes });

const png = makePng(2);
const be16 = (n) => [(n >>> 8) & 255, n & 255];
// a JPEG with just a frame header, and a lossy WebP with just its header: enough to be recognised
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, ...be16(17), 8, ...be16(30), ...be16(40), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(4), Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 40, 0, 30, 0, 0, 0])]);

// ---- pause ----
let r = await call("GET", "/api/queue/paused");
ok(r.status === 200 && r.json.paused === false, "the queue is not paused to begin with");
r = await call("PUT", "/api/queue/paused", { paused: true });
ok(r.status === 200 && r.json.paused === true, "it can be paused");
ok((await call("GET", "/api/queue/paused")).json.paused === true, "…and stays paused for the next request");
r = await call("PUT", "/api/queue/paused", { paused: false });
ok(r.json.paused === false && (await call("GET", "/api/queue/paused")).json.paused === false, "…and can be resumed");
ok((await call("PUT", "/api/queue/paused", { paused: "yes" })).status === 400, "paused must be true or false");
ok((await call("PUT", "/api/queue/paused", {})).status === 400, "…and must be given");

// ---- uploads ----
r = await send(png);
const up = (await r.json()).source;
ok(r.status === 201 && /^upload:[\w-]+$/.test(up), `a PNG is kept and named as upload:<id> (${up})`);
let got = await resolve(up);
ok(got.ok && got.type === "image/png" && got.bytes.equals(png), "…and the server gets back the same bytes");
const jp = (await (await send(jpeg, "image/jpeg")).json()).source;
got = await resolve(jp);
ok(got.ok && got.type === "image/jpeg" && got.bytes.equals(jpeg), "a JPEG keeps its type");
const wp = (await (await send(webp, "image/webp")).json()).source;
got = await resolve(wp);
ok(got.ok && got.type === "image/webp", "a WebP too");
ok((await send(png, "image/jpeg").then((x) => x.json())).source !== up, "each upload has its own id");

const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "mask.png");
r = await fetch(`${B}/api/queue/uploads`, { method: "POST", body: form });
const formSource = (await r.json()).source;
got = r.status === 201 ? await resolve(formSource) : null;
ok(r.status === 201 && got?.ok && got.bytes.equals(png), "a picture sent in a form's file field works too");
r = await fetch(`${B}/api/queue/uploads`, { method: "POST", body: new FormData() });
ok(r.status === 400, "a form with no file is refused");

ok((await send("just some text", "text/plain")).status === 415, "something that is not an image type is refused");
ok((await send("just some text", "image/png")).status === 415, "…as are bytes that are not a picture, whatever type they claim");
ok((await send(png.subarray(0, 20))).status === 415, "…and a cut-off picture");
ok((await send(Buffer.alloc(0))).status === 400, "…and an empty body");
ok((await send(Buffer.concat([png, Buffer.alloc(21 * 1024 * 1024)]))).status === 413, "a picture over 20 MB is refused");
ok(!(await resolve("upload:nosuch")).ok, "an upload that is not kept cannot be fetched");

// ---- the other sources ----
const comfy = await startFakeComfy({ port: 3557 });
const settingsBefore = (await call("GET", "/api/settings")).json.settings;
try {
  const put = await call("PUT", "/api/settings", { ...(settingsBefore ?? {}), comfy: { ...(settingsBefore?.comfy ?? {}), url: comfy.url } });
  ok(put.status === 200 && put.json.settings.comfy.url === comfy.url, "ComfyUI's address is set for the test");

  got = await resolve("comfy:StoryTime_9_3.png");
  ok(got.ok && got.type === "image/png" && got.bytes.equals(makePng(3)), "comfy:<file> is fetched from ComfyUI");
  got = await resolve("comfy:StoryTime/s1/header/StoryTime_9_5.png");
  ok(got.ok && got.bytes.equals(makePng(5)), "…also from a subfolder");
  const view = comfy.calls.filter((c) => c.path === "/view").at(-1);
  ok(view?.query?.filename === "StoryTime_9_5.png" && view.query.subfolder === "StoryTime/s1/header" && view.query.type === "output", "…asking for the file in the output folder");

  // saved pictures and the cover
  const s = await call("POST", "/api/stories", { title: "Sources", chapter: { title: "Root", body: "b", choices: [] } });
  const story = s.json.story_id, chapter = s.json.chapter_id;
  ok(!(await resolve(`saved:${chapter}:header`)).ok, "a header that is not saved is an error");
  await fetch(`${B}/api/chapters/${chapter}/images/header`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: makePng(1) });
  await fetch(`${B}/api/chapters/${chapter}/images/footer`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: makePng(4) });
  await fetch(`${B}/api/stories/${story}/cover`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: makePng(6) });
  ok((await resolve(`saved:${chapter}:header`)).bytes?.equals(makePng(1)), "saved:<chapter>:header is the chapter's header picture");
  ok((await resolve(`saved:${chapter}:footer`)).bytes?.equals(makePng(4)), "…and :footer its footer picture");
  ok((await resolve(`saved:${story}:cover`)).bytes?.equals(makePng(6)), "saved:<story>:cover is the story's cover");
  ok(!(await resolve(`saved:${chapter}:middle`)).ok, "a saved slot that does not exist is an error");

  // a codex picture
  const entry = (await call("POST", "/api/codex", { anchor_chapter_id: chapter, op: "create", name: "Mira", type: "character", content: "A thief." })).json.entry_id;
  const saved = await fetch(`${B}/api/stories/${story}/codex-pictures?entry=${entry}`, { method: "POST", headers: { "Content-Type": "image/png" }, body: makePng(7) });
  const pictureId = (await saved.json()).id;
  ok(saved.status === 201 && (await resolve(`codex:${pictureId}`)).bytes?.equals(makePng(7)), "codex:<picture id> is the codex entry's saved picture");
  ok(!(await resolve("codex:nosuch")).ok, "a codex picture that does not exist is an error");

  // what is not a source
  ok(!(await resolve("elsewhere:thing")).ok && !(await resolve("")).ok, "a source of another kind is an error");
  await call("PUT", "/api/settings", { ...(settingsBefore ?? {}), comfy: { ...(settingsBefore?.comfy ?? {}), url: "" } });
  const noUrl = await resolve("comfy:StoryTime_1_0.png");
  ok(!noUrl.ok && /No ComfyUI address/.test(noUrl.message), "with no ComfyUI address set, a comfy: source says so");
} finally {
  await comfy.close();
  // Other API test files expect that no settings have been saved yet (settings.test.mjs runs after this one).
  if (settingsBefore === null) {
    const d = new Database(process.env.TEST_DB);
    d.prepare("DELETE FROM settings WHERE key = 'settings'").run();
    d.close();
  }
}
