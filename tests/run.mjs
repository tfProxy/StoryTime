// Test runner.
//   node tests/run.mjs unit          pure-logic tests, no server
//   node tests/run.mjs api           HTTP API tests against a throwaway server + database
//   node tests/run.mjs e2e           browser tests (needs Edge, or set E2E_CHANNEL)
//   node tests/run.mjs unit api e2e  any combination
//   node tests/run.mjs e2e illustrate-resume chapters
//                                    only the files whose name contains one of the extra words
//
// The api and e2e suites start `next start` on PORT (default 3111) with a temporary SQLite
// file, and build the app first if there is no build yet (or if --build is given).
// The browser tests also use port 3222 for a fake AI server.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const wantBuild = args.includes("--build");
const SUITE_NAMES = ["unit", "api", "e2e"];
const suites = args.filter((a) => SUITE_NAMES.includes(a));
// Any other word is a filter: only the test files whose name contains it are run.
const filters = args.filter((a) => !a.startsWith("--") && !SUITE_NAMES.includes(a));
const PORT = Number(process.env.PORT ?? 3111);


if (suites.length === 0) {
  console.error("Usage: node tests/run.mjs [--build] <unit|api|e2e>... [file-name-part...]");
  process.exit(2);
}

const nodeBin = process.execPath;
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const filesFor = (dir, pattern) =>
  fs
    .readdirSync(path.join(root, "tests", dir))
    .filter((f) => pattern.test(f) && (filters.length === 0 || filters.some((x) => f.includes(x))))
    .sort()
    .map((f) => path.join(root, "tests", dir, f));

function runFile(file, env) {
  const rel = path.relative(root, file);
  console.log(`\n=== ${rel}`);
  const isTs = /\.mts$|\.ts$/.test(file);
  const r = spawnSync(nodeBin, isTs ? [tsx, file] : [file], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${r.stdout}${r.stderr}`.split(/\r?\n/).filter(Boolean);
  const failed = lines.filter((l) => l.startsWith("FAIL") || /Error|PAGEERROR/.test(l) && !l.startsWith("ok"));
  // Show everything for a failing file, otherwise just the tally.
  const passes = lines.filter((l) => l.startsWith("ok")).length;
  if (r.status !== 0) {
    console.log(lines.join("\n"));
    console.log(`FAILED (${rel}, exit ${r.status})`);
    return { file: rel, passes, ok: false };
  }
  console.log(`passed: ${passes} checks${failed.length ? ` (${failed.length} noisy line(s) ignored)` : ""}`);
  return { file: rel, passes, ok: true };
}

async function withServer(fn) {
  if (wantBuild || !fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.log("Building the app…");
    const b = spawnSync(nodeBin, [nextBin, "build"], { cwd: root, stdio: "inherit" });
    if (b.status !== 0) throw new Error("Build failed");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytime-test-"));
  const server = spawn(nodeBin, [nextBin, "start", "-p", String(PORT)], {
    cwd: root,
    // STORYTIME_TEST=1 turns on the routes that exist only for the API tests (see src/app/api/queue/test-items).
    env: { ...process.env, STORYTIME_DB: path.join(dir, "test.db"), STORYTIME_TEST: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  try {
    const base = `http://localhost:${PORT}`;
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(base)).ok) break;
      } catch {
        // not up yet
      }
      if (i > 60) throw new Error(`Server didn't start:\n${log}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    return await fn(base, path.join(dir, "test.db"));
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const results = [];
if (suites.includes("unit")) {
  for (const f of filesFor("unit", /\.test\.m?ts$/)) results.push(runFile(f, {}));
}
const needsServer = suites.some((s) => s === "api" || s === "e2e");
if (needsServer) {
  await withServer(async (base, dbFile) => {
    // Tests get the database path (for the command-line tool tests).
    const env = { BASE_URL: base, TEST_DB: dbFile };
    if (suites.includes("api")) {
      for (const f of filesFor("api", /\.test\.mjs$/)) results.push(runFile(f, env));
    }
    if (suites.includes("e2e")) {
      for (const f of filesFor("e2e", /\.e2e\.mjs$/)) results.push(runFile(f, env));
    }
  });
}

if (filters.length && results.length === 0) {
  console.error(`No test file matches: ${filters.join(", ")}`);
  process.exit(2);
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} test files passed, ${results.reduce((n, r) => n + r.passes, 0)} checks`);
if (bad.length) {
  console.log(`Failed: ${bad.map((b) => b.file).join(", ")}`);
  process.exit(1);
}
