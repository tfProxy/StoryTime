import { coverPromptRequest } from "../../src/lib/ai/coverPrompt.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

const ch = (title: string, body: string, extra: Record<string, unknown> = {}) => ({ title, body, summary: null, path_summary: null, ...extra });
const cx = (name: string, content: string, extra: Record<string, unknown> = {}) => ({ id: name, name, type: "character", aliases: [] as string[], content, always_include: false, ...extra });
const story = { title: "The Tale", premise: "A kitchen comedy." };
const jim = cx("Jim", "A tall man with blonde hair and a green apron.");
const zed = cx("Zed", "A one-eyed pirate captain.");
const base = {
  story,
  source: "premise" as "premise" | "opening" | "path",
  path: [ch("One", "Jim made a sandwich in the kitchen."), ch("Two", "Zed burst in through the window.")],
  codex: [jim, zed],
  direction: "",
  style: "tags" as const,
};

// ---- the system prompt: one per prompt style ----
const tags = coverPromptRequest(8000, { ...base, style: "tags" });
const natural = coverPromptRequest(8000, { ...base, style: "natural" });
ok(tags.system !== natural.system, "tags and natural styles have different system prompts");
ok(tags.system!.includes("comma-separated tags") && !tags.system!.includes("plain descriptive English"), "tags: asks for comma-separated tags");
ok(natural.system!.includes("plain descriptive English") && !natural.system!.includes("comma-separated tags"), "natural: asks for plain descriptive English");
for (const [name, r] of [["tags", tags], ["natural", natural]] as const) {
  ok(r.system!.includes("never use character or place names"), `${name}: the model is told not to use names`);
  ok(r.system!.includes("Do not describe an art style"), `${name}: the model is told not to describe an art style`);
  ok(r.system!.includes("no title, no words"), `${name}: nothing lettered in the picture`);
  ok(r.system!.includes("portrait") && r.system!.includes("room near the top") && r.system!.includes("title"), `${name}: portrait with room at the top for the title`);
  ok(r.system!.includes("Reply with JSON only") && r.system!.includes('"scene"') && r.system!.includes('"negative"'), `${name}: asks for the JSON shape`);
}
ok(tags.message === natural.message, "the message does not depend on the prompt style");

// ---- source "premise": no chapters ----
const prem = coverPromptRequest(8000, base);
ok(prem.message.startsWith("Story: The Tale\n\nPremise: A kitchen comedy."), "premise: the message starts with the story's title and premise");
ok(prem.message.includes("Write the cover from the premise and the codex."), "premise: the premise task text is in");
ok(!prem.message.includes("Jim made a sandwich") && !prem.message.includes("Zed burst in") && !prem.message.includes("The first chapter") && !prem.message.includes("The story along this path"), "premise: no chapter text even though the path has chapters");

// ---- source "opening": only the first chapter ----
const open = coverPromptRequest(8000, { ...base, source: "opening" });
ok(open.message.includes('The first chapter, "One":\nJim made a sandwich in the kitchen.'), "opening: the first chapter's title and text are in");
ok(!open.message.includes("Two") && !open.message.includes("Zed burst in"), "opening: later chapters are not in");
ok(open.message.includes("the story's first chapter"), "opening: the opening task text is in");
const long = ch("Long", `STARTMARK ${"word ".repeat(40000)} ENDMARK`);
const cut = coverPromptRequest(2000, { ...base, source: "opening", codex: [], path: [long] });
ok(cut.message.includes("STARTMARK") && !cut.message.includes("ENDMARK"), "opening: a very long first chapter keeps its start and loses its end");
ok(cut.message.includes("…"), "opening: a cut chapter ends with an ellipsis");
ok(cut.message.length < 40000, "opening: the cut chapter is much shorter than the original");

// ---- source "path": the whole path ----
const pth = coverPromptRequest(8000, { ...base, source: "path" });
ok(pth.message.includes("The story along this path"), "path: the story along this path is in");
ok(pth.message.includes("Jim made a sandwich in the kitchen.") && pth.message.includes("Zed burst in through the window."), "path: the text of every chapter is in");
ok(pth.message.includes("The story branches"), "path: the task says the story branches");

// ---- codex entries ----
ok(!prem.message.includes("Jim [character]") && !prem.message.includes("Zed [character]"), "premise: unmentioned entries are not in");
const premMention = coverPromptRequest(8000, { ...base, story: { title: "The Tale", premise: "Jim runs a kitchen." } });
ok(premMention.message.includes("Jim [character]: A tall man with blonde hair") && !premMention.message.includes("Zed"), "an entry the premise mentions is in, an unmentioned one is not");
ok(open.message.includes("Jim [character]: A tall man with blonde hair"), "opening: an entry the first chapter mentions is in");
ok(!open.message.includes("Zed"), "opening: an entry mentioned only in a chapter that is not included is not in");
ok(pth.message.includes("Jim [character]") && pth.message.includes("Zed [character]"), "path: entries mentioned in any chapter of the path are in");
const alwaysOpen = coverPromptRequest(8000, { ...base, source: "opening", codex: [jim, cx("Zed", "A one-eyed pirate captain.", { always_include: true })] });
ok(alwaysOpen.message.includes("Zed [character]") && alwaysOpen.message.includes("Jim [character]"), "an always-include entry is in even when not mentioned");
const alwaysPrem = coverPromptRequest(8000, { ...base, codex: [cx("Zed", "A one-eyed pirate captain.", { always_include: true })] });
ok(alwaysPrem.message.includes("Zed [character]"), "premise: an always-include entry is in");

// ---- direction and [notes] ----
ok(!prem.message.includes("The author wants") && !prem.message.includes("Additional instructions"), "no direction, no author section");
const dir = coverPromptRequest(8000, { ...base, direction: "Jim holding a sandwich [close-up] [warm light]" });
ok(dir.message.includes("The author wants the cover to show: Jim holding a sandwich\n"), "the direction is in as 'The author wants the cover to show', with the notes taken out");
ok(dir.message.includes("Additional instructions from the author") && dir.message.includes("- close-up") && dir.message.includes("- warm light"), "[notes] become an instructions block");
ok(!dir.message.includes("[close-up]") && !dir.message.includes("[warm light]") && !dir.message.split("\n").find((l) => l.startsWith("The author wants"))!.includes("["), "the brackets are not in the message");
const onlyNote = coverPromptRequest(8000, { ...base, direction: "[wide shot]" });
ok(!onlyNote.message.includes("The author wants") && onlyNote.message.includes("- wide shot"), "a direction of only a note adds just the instruction");
ok(dir.message.indexOf("The author wants") > dir.message.indexOf("Write the cover from"), "the direction comes after the task");
const viaDirection = coverPromptRequest(8000, { ...base, direction: "Zed on the deck" });
ok(viaDirection.message.includes("Zed [character]"), "an entry named only in the author's direction is in");

// ---- errors ----
ok(throws(() => coverPromptRequest(8000, { ...base, story: { title: "The Tale", premise: "" }, direction: "" })), "throws when the premise is empty, the source is premise and there is no direction");
ok(throws(() => coverPromptRequest(8000, { ...base, story: { title: "The Tale", premise: "  " }, direction: "" })), "throws when the premise is only spaces");
ok(throws(() => coverPromptRequest(8000, { ...base, source: "opening", path: [] })), "throws when the source is opening and the path is empty");
ok(throws(() => coverPromptRequest(8000, { ...base, source: "path", path: [] })), "throws when the source is path and the path is empty");
ok(throws(() => coverPromptRequest(8000, { ...base, source: "opening", path: [], direction: "A castle" })), "throws for opening with no chapters even when a direction is given");
ok(!throws(() => coverPromptRequest(8000, { ...base, story: { title: "The Tale", premise: "" }, path: [], direction: "A castle at dusk" })), "does not throw for an empty premise when a direction is given with source premise");
