// A codex entry's picture prompt: one clear picture of a character, item or place, written from the entry's
// text as of a chapter (so it follows the entry as the story changes it). Like the cover's (see ./coverPrompt)
// and the chapters' (see ./imagePrompt), the request is pure and `writeCodexPrompt` sends it from the browser.
import { completeChat } from "./client";
import { parseImagePrompt, STYLE_RULES, type ImagePrompt } from "./imagePrompt";
import { notesBlock, parseBracketNotes, type PromptParts } from "./prompts";
import type { EntryType } from "../codex";
import type { ImagePromptStyle, ModelRef, Settings } from "../settingsSchema";

export type CodexPromptOptions = {
  story: { title: string; premise: string };
  /** The entry as it reads at the chapter the page was opened from (or, with none, as last written). */
  entry: { name: string; type: EntryType; aliases: string[]; content: string };
  /** What the author wants shown, optionally with "[...]" notes. Empty lets the AI choose. */
  direction: string;
  style: ImagePromptStyle;
};

/** What the one picture shows, by the entry's type. */
const SUBJECT: Record<EntryType, string> = {
  character: "one clear full-body picture of the character: the whole figure from head to feet, standing and facing the viewer in a relaxed pose, on a plain, simple background",
  item: "one clear picture of the object: the whole object, centred and shown from its most recognisable side, on a plain, simple background",
  place: "one clear establishing picture of the place: a wide view that shows what kind of place it is and what it looks like, with no people in it",
  faction: "one clear picture of the group's emblem or banner, centred, on a plain, simple background",
  lore: "one clear picture that illustrates the idea, centred, with a single clear subject, on a plain, simple background",
  note: "one clear picture of the subject, centred, with a single clear subject, on a plain, simple background",
};

const SYSTEM_CODEX = (style: ImagePromptStyle, type: EntryType) => `You write a prompt for an AI image generator for a picture of one codex entry of a story: a reference picture that shows what the entry looks like, so it can be drawn the same way in later pictures.
- The picture is ${SUBJECT[type]}.
- Nothing else competes with the subject: no other characters, no story scene, no action, no text.
- Describe only what can be seen. The image model has never read the story and does not know any names, so never use character or place names: describe people and places by how they look.
- Take everything from the entry's text. Do not invent visible details that contradict it; where nothing is said, pick plausible, unremarkable details.
- Do not describe an art style, medium or artist; the author's art style is added separately.
- Nothing written or lettered in the picture.

${STYLE_RULES[style]}

Reply with JSON only: {"scene":"","prompt":"","negative":""}
"scene" is one or two plain sentences telling the author what the picture shows.`;

/** The request for a codex entry's prompt; throws if there is nothing to go on. */
export function codexPromptRequest(opts: CodexPromptOptions): PromptParts {
  const { text: direction, notes } = parseBracketNotes(opts.direction);
  const { entry } = opts;
  if (!entry.content.trim() && !direction) {
    throw new Error("There's nothing to write the picture from yet: add a description to the codex entry, or say what to show.");
  }

  const parts = [`Story: ${opts.story.title || "(untitled)"}`];
  if (opts.story.premise.trim()) parts.push(`Premise: ${opts.story.premise.trim()}`);
  const header = [`The codex entry: ${entry.name} (${entry.type})`];
  if (entry.aliases.length) header.push(`Also known as: ${entry.aliases.join(", ")}`);
  parts.push(`${header.join("\n")}\n${entry.content.trim() || "(no description)"}`);
  parts.push(`Write the prompt for ${SUBJECT[entry.type]}.`);
  if (direction) parts.push(`The author wants the picture to show: ${direction}`);
  if (notes.length) parts.push(notesBlock(notes));
  return { system: SYSTEM_CODEX(opts.style, entry.type), message: parts.join("\n\n") };
}

export async function writeCodexPrompt(
  settings: Settings,
  opts: CodexPromptOptions & { model?: ModelRef | null; signal?: AbortSignal },
): Promise<ImagePrompt> {
  const request = codexPromptRequest(opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: "cheap",
    model: opts.model,
    signal: opts.signal,
  });
  return parseImagePrompt(reply);
}
