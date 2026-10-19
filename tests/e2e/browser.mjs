import { chromium } from "playwright-core";

// Uses Microsoft Edge by default (present on Windows). Set E2E_CHANNEL to another installed
// channel (for example "chrome"), or to "bundled" to use a Playwright-managed Chromium
// (install it first with: npx playwright-core install chromium). E2E_EXECUTABLE points at a
// browser binary directly instead.
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
    ...extra,
  };
  await put(settings);
  return {
    restore: () => put(before ?? {}),
    breakConnection: () => put({ ...settings, connections: [{ ...conn, baseUrl: "http://localhost:1/v1" }] }),
  };
}
