import { applyEdits, findPassage } from "../../src/lib/retconText.ts";
import { parseRetcon, retconRequest } from "../../src/lib/ai/retconAi.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- findPassage: the chapter's own spelling ----
{
  const body = "She looked up. “Your eyes,” he said — “they’re gray as rain.”\n\nMira   blinked…";
  ok(findPassage("She looked up.", body) === "She looked up.", "an exact passage is found as it is");
  ok(findPassage(`"they're gray as rain."`, body) === "“they’re gray as rain.”", "straight quotes find curly ones; the chapter's spelling comes back");
  ok(findPassage("he said - \"they're", body) === "he said — “they’re", "a hyphen finds a dash");
  ok(findPassage("mira blinked...", body) === "Mira   blinked…", "case, spacing and an ellipsis are evened out");
  ok(findPassage("green as grass", body) === null, "a passage that isn't there is null");
  ok(findPassage("   ", body) === null, "an empty passage is null");
}

// ---- applyEdits ----
{
  const body = "Her gray eyes narrowed. Later, her gray eyes softened.";
  const summary = "Mira, gray-eyed, waits.";
  const r = applyEdits([body, summary], [
    { old: "gray eyes", new: "blue eyes" },
    { old: "Mira, gray-eyed", new: "Mira, blue-eyed" },
    { old: "not here", new: "x" },
  ]);
  ok(r.texts[0] === "Her blue eyes narrowed. Later, her blue eyes softened.", "every occurrence in the body is replaced");
  ok(r.texts[1] === "Mira, blue-eyed, waits.", "a passage only in the summary is replaced there");
  ok(r.missing.length === 1 && r.missing[0].old === "not here", "a passage in neither is reported missing");
}

// ---- parseRetcon ----
{
  const body = "“Your eyes are gray,” Oda said. Mira smiled.";
  const reply = "Sure:\n```json\n" + JSON.stringify({
    edits: [
      { old: "\"Your eyes are gray,\" Oda said.", new: "“Your eyes are blue,” Oda said." },
      { old: "Not in the chapter.", new: "x" },
      { old: "Mira smiled.", new: "Mira smiled." },
      { old: "“Your eyes are gray,” Oda said.", new: "dup" },
    ],
    note: "Nothing else.",
  }) + "\n```";
  const r = parseRetcon(reply, [body, ""]);
  ok(r.edits.length === 1, "unfound, unchanged and repeated passages are dropped: " + JSON.stringify(r.edits));
  ok(r.edits[0]?.old === "“Your eyes are gray,” Oda said.", "the passage is kept in the chapter's own spelling");
  ok(r.note === "Nothing else.", "the note is kept");
  let threw = false;
  try {
    parseRetcon("not json", [body]);
  } catch {
    threw = true;
  }
  ok(threw, "a reply that isn't JSON throws (the run tries the chapter again)");
  ok(parseRetcon('{"edits":[]}', [body]).edits.length === 0, "no edits is fine");
}

// ---- the request ----
{
  const r = retconRequest(8000, { instruction: "Mira's eyes are blue.", chapter: { title: "Rain", body: "x".repeat(100), summary: "A summary." } });
  ok(r.message.includes("Mira's eyes are blue.") && r.message.includes('Chapter: "Rain"') && r.message.includes("A summary."), "the request has the change, the chapter and its summary");
  const long = retconRequest(2000, { instruction: "i", chapter: { title: "T", body: "y".repeat(100000), summary: null } });
  ok(long.message.length < 20000 && long.message.includes("…"), "a long chapter is cut to fit");
}
