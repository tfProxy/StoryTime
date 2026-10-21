// Screenshots a page at desktop and phone width, to look at a UI change.
//   node tests/shot.mjs /s/1                  page on the running app (BASE, default http://localhost:3737)
//   node tests/shot.mjs /s/1 /c/4 --out=dir   several pages; PNGs go to dir (default: <tmp>/storytime-shots)
//   node tests/shot.mjs /settings --full      whole page, not just the first screen
//   node tests/shot.mjs /c/4 --wait="text=Queue"  wait for a selector before the shot
// Needs the app running (`npm run dev`, or `npm start` after a build). Uses the same browser as the
// browser tests: Edge by default, or E2E_EXECUTABLE=/opt/pw-browsers/chromium in a cloud sandbox.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch } from "./e2e/browser.mjs";

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const pages = args.filter((a) => !a.startsWith("--"));
const base = (process.env.BASE ?? "http://localhost:3737").replace(/\/$/, "");
const out = opt("out") ?? path.join(os.tmpdir(), "storytime-shots");
const wait = opt("wait");
const fullPage = args.includes("--full");

if (pages.length === 0) {
  console.error("Usage: node tests/shot.mjs <path>... [--out=dir] [--full] [--wait=selector]");
  process.exit(2);
}
try {
  await fetch(`${base}/api/health`);
} catch {
  console.error(`Nothing answers at ${base}. Start the app first (npm run dev), or set BASE.`);
  process.exit(1);
}

const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  // Scale 1 keeps the image small (and cheap for Claude to look at); the layout is the same.
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};

fs.mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  for (const [size, options] of Object.entries(SIZES)) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log(`PAGEERROR ${size}: ${e.message}`));
    for (const p of pages) {
      await page.goto(p.startsWith("http") ? p : `${base}${p.startsWith("/") ? "" : "/"}${p}`, { waitUntil: "networkidle" });
      if (wait) await page.waitForSelector(wait, { timeout: 10_000 });
      const name = `${p.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}-${size}.png`;
      const file = path.join(out, name);
      await page.screenshot({ path: file, fullPage });
      console.log(file);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
