import { chromium } from "playwright-core";

// Uses Microsoft Edge by default (present on Windows). Set E2E_CHANNEL to another installed
// channel (for example "chrome"), or to "bundled" to use a Playwright-managed Chromium
// (install it first with: npx playwright-core install chromium). E2E_EXECUTABLE points at a
// browser binary directly instead.
/**
 * ComfyUI settings in the preset format: one drawing preset ("Test drawing", id "test") with the
 * checkpoint, changed by `draw`, and each edit model's Default preset (whose id is the model's), changed
 * by `edit[model]`.
 */
export function comfySettings({ url, checkpoint = "", width = 1344, height = 768, count = 2, draw = {}, edit = {}, editPreset = "qwen-image-edit" }) {
  return {
    url,
    width,
    height,
    count,
    drawPresets: [{ id: "test", name: "Test drawing", checkpoint, workflow: "", loras: [], sampler: {}, denoise: 0.55, ...draw }],
    editPresets: ["qwen-image-edit", "flux-kontext"].map((m) => ({ id: m, name: "Default", model: m, fast: true, loras: [], tuning: {}, ...(edit[m] ?? {}) })),
    editPreset,
  };
}

export function launch() {
  if (process.env.E2E_EXECUTABLE) return chromium.launch({ headless: true, executablePath: process.env.E2E_EXECUTABLE });
  const channel = process.env.E2E_CHANNEL ?? "msedge";
  return chromium.launch({ headless: true, ...(channel === "bundled" ? {} : { channel }) });
}

/**
 * Points the app's AI settings at the fake AI server the tests run on port 3222. The settings
 * live on the StoryTime server (not in the browser), so this saves them there; `restore` puts
 * back what was there before, and `breakConnection` points the connection at a dead port.
 */
export async function useMockAi(base, { main = "main", cheap = "cheap", ...extra } = {}) {
  const put = (s) =>
    fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
  const before = (await (await fetch(`${base}/api/settings`)).json()).settings;
  const conn = { id: "t", name: "Test", kind: "ollama", baseUrl: "http://localhost:3222/v1", apiKey: "" };
  const settings = {
    ...(before ?? {}),
    connections: [conn],
    favorites: [],
    defaults: { main: { connectionId: "t", model: main }, cheap: cheap ? { connectionId: "t", model: cheap } : null },
    // No automatic codex check after a chapter is saved: it would add AI requests and queue items the tests don't expect.
    autoCodex: false,
    ...extra,
  };
  await put(settings);
  return {
    restore: () => put(before ?? {}),
    breakConnection: () => put({ ...settings, connections: [{ ...conn, baseUrl: "http://localhost:1/v1" }] }),
  };
}

/**
 * Starts a new story the way the app does: the New story form (title, summary, style notes), then Start
 * writing on its details page. Leaves the page on the first-chapter draft; returns the story's id.
 */
export async function startStory(page, base, { title, premise = "", style = "" }) {
  await page.goto(`${base}/new`);
  await page.getByLabel("Story title").fill(title);
  if (premise) await page.getByLabel(/^Summary/).fill(premise);
  if (style) await page.getByLabel(/^Style notes/).fill(style);
  await page.getByRole("button", { name: "Create story" }).click();
  await page.waitForURL(/\/s\/[^/]+\/details$/);
  const id = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("link", { name: "Start writing" }).click();
  await page.waitForURL(`**/s/${id}/write`);
  await page.getByRole("heading", { name: "Write the first chapter" }).waitFor();
  return id;
}
