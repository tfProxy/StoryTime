// The command-line moderation tool, run against the same database the server is using.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const B = process.env.BASE_URL ?? "http://localhost:3111";
const DB = process.env.TEST_DB;
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "admin.mjs");
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const api = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const cli = (...args) => {
  const r = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, STORYTIME_DB: DB }, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

ok(Boolean(DB), "test database path is provided");
let r = cli("help");
ok(r.code === 0 && r.out.includes("recent") && r.out.includes("delete"), "help lists the commands");
r = cli("recent", "1");
ok(r.code === 0, "recent runs against the live database");

const s = await api("POST", "/api/stories", { title: "CLI story", author_name: "Cleo", chapter: { title: "CLI root", body: "hello there", choices: ["Go"] } });
const root = s.json.chapter_id;
const choice = (await api("GET", `/api/chapters/${root}`)).json.choices[0];
const child = (await api("POST", "/api/chapters", { choice_id: choice.id, title: "CLI child", body: "child text", author_name: "Cleo" })).json.chapter_id;

r = cli("stats");
ok(/stories: \d+/.test(r.out) && /chapters: \d+/.test(r.out), "stats prints counts");
r = cli("recent", "10", "--kind", "chapter", "--story", s.json.story_id);
ok(r.out.includes("CLI child") && r.out.includes("CLI root") && r.out.includes(child) && r.out.includes("(by "), "recent lists chapters with ids, a preview and authors: " + r.out.split("\n")[0]);
ok(!r.out.includes("[REMOVED]"), "nothing is flagged yet");

r = cli("remove", "chapter", child);
ok(r.code === 0 && /Removed chapter/.test(r.out), "remove: " + r.out.trim());
ok((await api("GET", `/api/chapters/${child}`)).status === 404, "…and readers no longer see it");
r = cli("recent", "10", "--removed", "--story", s.json.story_id);
ok(r.out.includes("CLI child") && r.out.includes("[REMOVED]") && !r.out.includes("CLI root"), "--removed lists only removed items");
r = cli("restore", "chapter", child);
ok(r.code === 0 && /Restored/.test(r.out) && (await api("GET", `/api/chapters/${child}`)).status === 200, "restore brings it back");

r = cli("delete", "chapter", child);
ok(r.code === 1 && /--yes/.test(r.err), "delete refuses without --yes");
r = cli("delete", "chapter", child, "--yes");
ok(r.code === 1 && /Remove it first/.test(r.err), "delete refuses an item that isn't removed");
cli("remove", "chapter", child);
r = cli("delete", "chapter", child, "--yes");
ok(r.code === 0 && /Deleted 1 chapter/.test(r.out), "delete permanently: " + r.out.trim());
ok((await api("GET", `/api/chapters/${root}`)).json.choices[0].child_chapter_id === null, "the slot is open again");

// revert via CLI
const key = "cli-edit-key-0123456789ab";
const s2 = await api("POST", "/api/stories", { title: "CLI revert", chapter: { title: "Orig", body: "original text", edit_key: key } });
await api("PATCH", `/api/chapters/${s2.json.chapter_id}`, { edit_key: key, base_revision: 1, title: "Changed", body: "changed text" });
r = cli("revert", s2.json.chapter_id, "1");
ok(r.code === 0 && /revision 3/.test(r.out), "revert: " + r.out.trim());
ok((await api("GET", `/api/chapters/${s2.json.chapter_id}`)).json.chapter.body === "original text", "the original text is back");

r = cli("remove", "chapter", "no-such-id");
ok(r.code === 1 && /No chapter with id/.test(r.err), "unknown id is a clean error");
r = cli("remove", "widget", "x");
ok(r.code === 1 && /Unknown kind/.test(r.err), "unknown kind is a clean error");
r = cli("frobnicate");
ok(r.code === 1 && /Unknown command/.test(r.err), "unknown command is a clean error");
const bad = spawnSync(process.execPath, [script, "stats"], { env: { ...process.env, STORYTIME_DB: DB + ".missing" }, encoding: "utf8" });
ok(bad.status === 2 && /No database/.test(bad.stderr), "a missing database is reported");
