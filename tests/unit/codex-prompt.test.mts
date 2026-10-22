import { codexPromptRequest } from "../../src/lib/ai/codexPrompt.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

const story = { title: "The Tale", premise: "A kitchen comedy." };
const entry = (type: "character" | "item" | "place" | "faction", extra: Record<string, unknown> = {}) => ({
  name: "Jim",
  type,
  aliases: ["Jimbo"],
  content: "A tall man with blonde hair and a green apron.",
  ...extra,
});
const base = { story, entry: entry("character"), direction: "", style: "tags" as const };

// ---- the system prompt ----
const tags = codexPromptRequest(base);
const natural = codexPromptRequest({ ...base, style: "natural" });
ok(tags.system !== natural.system, "tags and natural styles have different system prompts");
ok(tags.system!.includes("comma-separated tags") && !tags.system!.includes("plain descriptive English"), "tags: asks for comma-separated tags");
ok(natural.system!.includes("plain descriptive English") && !natural.system!.includes("comma-separated tags"), "natural: asks for plain descriptive English");
for (const [name, r] of [["tags", tags], ["natural", natural]] as const) {
  ok(r.system!.includes("never use character or place names"), `${name}: the model is told not to use names`);
  ok(r.system!.includes("Do not describe an art style"), `${name}: the model is told not to describe an art style`);
  ok(r.system!.includes("Nothing written or lettered"), `${name}: nothing lettered in the picture`);
  ok(r.system!.includes("Reply with JSON only") && r.system!.includes('"scene"') && r.system!.includes('"negative"'), `${name}: asks for the JSON shape`);
}
ok(tags.message === natural.message, "the message does not depend on the prompt style");

// ---- what each type shows ----
ok(tags.system!.includes("full-body") && tags.system!.includes("plain, simple background"), "a character: one full-body picture on a plain background");
const item = codexPromptRequest({ ...base, entry: entry("item", { name: "Lamp", content: "A brass oil lamp." }) });
ok(item.system!.includes("the whole object") && item.system!.includes("plain, simple background") && !item.system!.includes("full-body"), "an item: the whole object on a plain background");
const place = codexPromptRequest({ ...base, entry: entry("place", { name: "Inn", content: "A low stone tavern." }) });
ok(place.system!.includes("establishing") && place.system!.includes("no people"), "a place: an establishing picture");
ok(codexPromptRequest({ ...base, entry: entry("faction") }).system!.includes("emblem"), "a faction: its emblem");

// ---- the message ----
ok(tags.message.startsWith("Story: The Tale\n\nPremise: A kitchen comedy."), "the message starts with the story's title and premise");
ok(tags.message.includes("The codex entry: Jim (character)\nAlso known as: Jimbo\nA tall man with blonde hair and a green apron."), "…then the entry's name, type, aliases and text");
ok(!tags.message.includes("The author wants"), "…with no direction unless one is given");
const noAlias = codexPromptRequest({ ...base, entry: entry("character", { aliases: [] }) });
ok(!noAlias.message.includes("Also known as"), "no aliases, no 'Also known as' line");
const dir = codexPromptRequest({ ...base, direction: "in a red coat [no hat]" });
ok(dir.message.includes("The author wants the picture to show: in a red coat"), "the author's direction is passed on");
ok(dir.message.includes("no hat") && dir.message.indexOf("no hat") > dir.message.indexOf("in a red coat"), "…and its [notes] as instructions");

// ---- nothing to go on ----
ok(throws(() => codexPromptRequest({ ...base, entry: entry("character", { content: "  " }) })), "an entry with no text and no direction can't be written from");
ok(!throws(() => codexPromptRequest({ ...base, entry: entry("character", { content: "" }), direction: "a knight" })), "…but a direction is enough");
ok(!throws(() => codexPromptRequest({ ...base, story: { title: "", premise: "" } })), "…and the story need not have a premise");
