#!/usr/bin/env node
// Command-line maintenance tool. Runs on the machine that hosts the database, so no password is
// needed (anyone who can run it can already read the database file).
//
//   node scripts/admin.mjs stats
//   node scripts/admin.mjs recent [count] [--kind chapter|story|choice|codex_op] [--story <id>] [--removed]
//   node scripts/admin.mjs remove  <chapter|story|choice|codex_op> <id>
//   node scripts/admin.mjs restore <chapter|story|choice|codex_op> <id>
//   node scripts/admin.mjs delete  <chapter|story> <id> --yes     (permanent; must be removed first)
//   node scripts/admin.mjs revert  <chapterId> <revision>
//   node scripts/admin.mjs backup  <file>                          (a consistent copy, safe while the app runs)
//
// In Docker:  docker exec -it storytime node scripts/admin.mjs recent 20
// The database is $STORYTIME_DB, or ./data/storytime.db.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { AdminError, hardDelete, recentActivity, remove, restore, revertChapter, stats } from "./adminCore.mjs";

const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const name = args[i].slice(2);
    const takesValue = name === "kind" || name === "story";
    flags.set(name, takesValue ? args[++i] : true);
  } else positional.push(args[i]);
}
const [command, a, b] = positional;

const file = process.env.STORYTIME_DB ?? path.join(process.cwd(), "data", "storytime.db");
if (!command || command === "help" || !fs.existsSync(file)) {
  if (command && command !== "help") console.error(`No database at ${file}. Set STORYTIME_DB to its path.\n`);
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(command === "help" ? 0 : 2);
}

const db = new Database(file);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const when = (t) => new Date(t).toISOString().replace("T", " ").slice(0, 16);

try {
  switch (command) {
    case "stats": {
      const s = stats(db);
      console.log(`stories: ${s.stories}  chapters: ${s.chapters}  codex changes: ${s.codexOps}  removed items: ${s.removed}`);
      break;
    }
    case "recent": {
      const rows = recentActivity(db, {
        limit: a && /^\d+$/.test(a) ? Number(a) : 25,
        kind: flags.get("kind"),
        storyId: flags.get("story"),
        removedOnly: flags.has("removed"),
      });
      for (const r of rows) {
        const flag = r.removed_at ? " [REMOVED]" : "";
        console.log(`${when(r.at)}  ${r.kind.padEnd(8)} ${r.id}  ${r.story_title} › ${r.label}${r.author ? `  (by ${r.author})` : ""}${flag}`);
        if (r.preview) console.log(`    ${r.preview.replace(/\s+/g, " ").slice(0, 110)}`);
      }
      if (rows.length === 0) console.log("(nothing)");
      break;
    }
    case "remove": {
      const r = remove(db, a, b);
      console.log(r.changed ? `Removed ${a} ${b}${r.hidden ? ` (and hid ${r.hidden} chapter${r.hidden === 1 ? "" : "s"} below it)` : ""}.` : "Already removed.");
      break;
    }
    case "restore": {
      const r = restore(db, a, b);
      console.log(r.changed ? `Restored ${a} ${b}.${r.note ? ` ${r.note}` : ""}` : "It wasn't removed.");
      break;
    }
    case "delete": {
      if (!flags.has("yes")) throw new AdminError("This deletes permanently. Add --yes to confirm.");
      const r = hardDelete(db, a, b);
      console.log(`Deleted ${r.chapters} chapter${r.chapters === 1 ? "" : "s"} and ${r.codexOps} codex change${r.codexOps === 1 ? "" : "s"}.`);
      break;
    }
    case "revert": {
      const r = revertChapter(db, a, Number(b));
      console.log(`Reverted. The chapter is now at revision ${r.revision}.`);
      break;
    }
    case "backup": {
      if (!a) throw new AdminError("Give a file to write the backup to, e.g. backup /data/backups/storytime.db");
      const dest = path.resolve(a);
      if (fs.existsSync(dest)) throw new AdminError(`${dest} already exists; choose a new file name.`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await db.backup(dest);
      console.log(`Backed up to ${dest} (${Math.round(fs.statSync(dest).size / 1024)} KB).`);
      break;
    }
    default:
      throw new AdminError(`Unknown command "${command}". Run with "help" for usage.`);
  }
} catch (e) {
  if (e instanceof AdminError) {
    console.error(e.message);
    process.exitCode = 1;
  } else throw e;
} finally {
  db.close();
}
