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
