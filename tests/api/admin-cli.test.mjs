// The command-line moderation tool, run against the same database the server is using.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

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

const s = await api("POST", "/api/stories", { title: "CLI story", chapter: { title: "CLI root", body: "hello there", choices: ["Go"] } });
const root = s.json.chapter_id;
const choice = (await api("GET", `/api/chapters/${root}`)).json.choices[0];
const child = (await api("POST", "/api/chapters", { choice_id: choice.id, title: "CLI child", body: "child text" })).json.chapter_id;

// both chapters get a picture, to check the tool deletes them with the chapter
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const putPicture = (id, slot) => fetch(`${B}/api/chapters/${id}/images/${slot}`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
const hasPicture = async (id, slot) => (await fetch(`${B}/api/chapters/${id}/images/${slot}`)).status === 200;
ok((await putPicture(child, "header")).status === 200 && (await putPicture(root, "footer")).status === 200, "the chapters have pictures");

r = cli("stats");
ok(/stories: \d+/.test(r.out) && /chapters: \d+/.test(r.out), "stats prints counts");
r = cli("recent", "10", "--kind", "chapter", "--story", s.json.story_id);
ok(r.out.includes("CLI child") && r.out.includes("CLI root") && r.out.includes(child), "recent lists chapters with ids and a preview: " + r.out.split("\n")[0]);

r = cli("delete", "chapter", child);
ok(r.code === 1 && /--yes/.test(r.err), "delete refuses without --yes");
ok((await api("GET", `/api/chapters/${child}`)).status === 200, "and leaves the chapter alone");
r = cli("delete", "chapter", root, "--yes");
ok(r.code === 1 && /delete the story instead/.test(r.err), "delete refuses a story's first chapter");
r = cli("delete", "chapter", child, "--yes");
ok(r.code === 0 && /Deleted 1 chapter/.test(r.out), "delete permanently: " + r.out.trim());
ok((await api("GET", `/api/chapters/${child}`)).status === 404, "readers no longer see it");
ok(!(await hasPicture(child, "header")) && (await hasPicture(root, "footer")), "its picture is deleted with it, and the other chapter's is kept");
ok((await api("GET", `/api/chapters/${root}`)).json.choices[0].child_chapter_id === null, "the slot is open again");

// deleting a choice takes the chapter written for it, with everything below
const grand = (await api("POST", "/api/chapters", { choice_id: choice.id, title: "Again", body: "again", choices: ["On"] })).json.chapter_id;
const onChoice = (await api("GET", `/api/chapters/${grand}`)).json.choices[0];
const great = (await api("POST", "/api/chapters", { choice_id: onChoice.id, title: "Further", body: "further" })).json.chapter_id;
r = cli("delete", "choice", choice.id, "--yes");
ok(r.code === 0 && /Deleted 2 chapters/.test(r.out), "deleting a choice deletes its chapter and what is below: " + r.out.trim());
ok((await api("GET", `/api/chapters/${grand}`)).status === 404 && (await api("GET", `/api/chapters/${great}`)).status === 404, "both chapters are gone");
ok((await api("GET", `/api/chapters/${root}`)).json.choices.length === 0, "the choice is gone");

// deleting a story takes all of its contents
r = cli("delete", "story", s.json.story_id, "--yes");
ok(r.code === 0 && /Deleted 1 chapter/.test(r.out), "delete a story: " + r.out.trim());
ok((await api("GET", `/api/stories/${s.json.story_id}`)).status === 404, "the story is gone");
ok(!(await hasPicture(root, "footer")), "…and so are its chapters' pictures");

// revert via CLI
const s2 = await api("POST", "/api/stories", { title: "CLI revert", chapter: { title: "Orig", body: "original text" } });
await api("PATCH", `/api/chapters/${s2.json.chapter_id}`, { base_revision: 1, title: "Changed", body: "changed text" });
r = cli("revert", s2.json.chapter_id, "1");
ok(r.code === 0 && /revision 3/.test(r.out), "revert: " + r.out.trim());
ok((await api("GET", `/api/chapters/${s2.json.chapter_id}`)).json.chapter.body === "original text", "the original text is back");

// backup: a consistent copy that opens as a database with the same content
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storytime-backup-"));
const dest = path.join(dir, "nested", "copy.db");
r = cli("backup", dest);
ok(r.code === 0 && /Backed up to/.test(r.out) && fs.existsSync(dest), "backup writes a copy (creating folders): " + r.out.trim().slice(0, 60));
const copy = new Database(dest, { readonly: true });
ok(copy.prepare("SELECT COUNT(*) AS n FROM chapters").get().n > 0 && copy.prepare("SELECT title FROM stories WHERE title = ?").get("CLI revert")?.title === "CLI revert", "the copy contains the live data");
copy.close();
r = cli("backup", dest);
ok(r.code === 1 && /already exists/.test(r.err), "backup refuses to overwrite an existing file");
r = cli("backup");
ok(r.code === 1 && /Give a file/.test(r.err), "backup needs a file name");
fs.rmSync(dir, { recursive: true, force: true });

r = cli("delete", "chapter", "no-such-id", "--yes");
ok(r.code === 1 && /No chapter with id/.test(r.err), "unknown id is a clean error");
r = cli("delete", "widget", "x", "--yes");
ok(r.code === 1 && /Unknown kind/.test(r.err), "unknown kind is a clean error");
r = cli("frobnicate");
ok(r.code === 1 && /Unknown command/.test(r.err), "unknown command is a clean error");
const bad = spawnSync(process.execPath, [script, "stats"], { env: { ...process.env, STORYTIME_DB: DB + ".missing" }, encoding: "utf8" });
ok(bad.status === 2 && /No database/.test(bad.stderr), "a missing database is reported");
