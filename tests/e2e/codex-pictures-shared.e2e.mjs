// The picture page of a codex entry: an entry linked to a shared entry offers "Use for" (this story only / every
// story that uses this entry), and a shared picture shows with a "shared" tag; a plain entry has no such choice.
import { comfySettings, launch } from "./browser.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
let failed = false;
const putSettings = (s) => fetch(`${BASE}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
const before = (await (await fetch(`${BASE}/api/settings`)).json()).settings;
// The picture cards show once a ComfyUI address is set (nothing here talks to it).
await putSettings({ ...(before ?? {}), comfy: comfySettings({ url: "http://localhost:3591" }) });
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const call = async (method, url, body) => (await fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const created = await call("POST", "/api/stories", { title: "Shared picture page", chapter: { title: "Start", body: "Begin.", choices: [] } });
const { story_id: storyId, chapter_id: root } = created;
const sid = (await call("POST", "/api/shared", { name: "Zz Picture test", type: "character", content: "Base." })).id;
const linked = (await call("POST", "/api/codex/link", { anchor_chapter_id: root, shared_entry_id: sid })).entry_id;
const plain = (await call("POST", "/api/codex", { anchor_chapter_id: root, op: "create", name: "Plainthing", type: "place", content: "A spot." })).entry_id;

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1500 } })).newPage();
page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failed = true; });
try {
  const use = page.getByLabel("Use for");
  const heading = page.getByRole("heading", { name: "Codex picture", exact: true });
  await page.goto(`${BASE}/s/${storyId}/codex/${plain}/pictures?at=${root}`);
  await heading.waitFor();
  ok((await use.count()) === 0, "a plain entry has no Use for choice");

  await page.goto(`${BASE}/s/${storyId}/codex/${linked}/pictures?at=${root}`);
  await heading.waitFor();
  ok((await use.count()) === 1 && (await use.inputValue()) === "story", "a linked entry offers Use for, set to this story only");
  await use.selectOption("all");
  ok((await use.inputValue()) === "all", "…and can be set to every story");

  const saved = await fetch(`${BASE}/api/stories/${storyId}/codex-pictures?entry=${linked}&shared=1`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
  ok(saved.status === 201, "a shared picture is saved");
  await page.goto(`${BASE}/s/${storyId}/codex/${linked}/pictures?at=${root}`);
  await heading.waitFor();
  ok((await page.locator(".image-editor .tag", { hasText: "shared" }).count()) === 1, "the card tags the shared picture");
} finally {
  await browser.close();
  const restored = await putSettings(before ?? {});
  ok(restored.ok, `settings restored (${restored.status}, ${JSON.stringify(before ?? null).slice(0, 60)})`);
}
process.exit(failed ? 1 : 0);
