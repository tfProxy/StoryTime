// The cover's picture prompt: like a chapter's (see ./imagePrompt), but for the whole story. A story
// branches, so the prompt is written from what is chosen: the premise and codex alone, those and the
// first chapter, or a path from the first chapter to a chosen one. The request is pure;
// `writeCoverPrompt` sends it from the browser like every other AI call.
import { completeChat } from "./client";
import { parseImagePrompt, STYLE_RULES, type ImagePrompt } from "./imagePrompt";
import {
  buildCodexBlock,
  buildStorySoFar,
  budgetFor,
  codexBudget,
  estimateTokens,
  notesBlock,
  parseBracketNotes,
  type ContextChapter,
  type ContextCodexEntry,
  type PromptParts,
} from "./prompts";
import type { CoverSource } from "../pictureTarget";
import type { ImagePromptStyle, ModelRef, Settings } from "../settingsSchema";

export type CoverPromptOptions = {
  story: { title: string; premise: string };
  source: CoverSource;
  /**
   * The chapters the prompt is written from: none for the premise, the first chapter for the opening,
   * or the path from the first chapter to the chosen one.
   */
  path: ContextChapter[];
  /** Codex entries in effect at the last chapter of `path` (or the first chapter, for the premise). */
  codex: ContextCodexEntry[];
  /** What the author wants shown, optionally with "[...]" notes. Empty lets the AI choose. */
  direction: string;
  style: ImagePromptStyle;
};

const SYSTEM_COVER = (style: ImagePromptStyle) => `You write a prompt for an AI image generator for the cover of a story, like the cover of a book.
- One striking picture that tells a browser what kind of story this is: its main character or characters, or its central place, and its mood. Not a busy scene, and not one particular moment that only makes sense after reading.
- A tall, portrait picture with a clear focal point and room near the top, where the title will go.
- Describe only what can be seen. The image model has never read the story and does not know any names, so never use character or place names: describe people and places by how they look.
- Take appearance and places from the codex and the story. Do not invent visible details that contradict them; where nothing is said, pick plausible, unremarkable details.
- Give nothing away that a reader starting the story wouldn't know.
- Do not describe an art style, medium or artist; the author's art style is added separately.
- Nothing written or lettered in the picture: no title, no words.

${STYLE_RULES[style]}

Reply with JSON only: {"scene":"","prompt":"","negative":""}
"scene" is one or two plain sentences telling the author what the cover shows.`;

const SOURCE_TASK: Record<CoverSource, string> = {
  premise: "Write the cover from the premise and the codex.",
  opening: "Write the cover from the premise, the codex and the story's first chapter, as the reader meets it.",
  path: "Write the cover from the premise, the codex and this path through the story. The story branches, so this is one way it can go.",
};

/** The request for a cover prompt; throws if the story has nothing to go on. */
export function coverPromptRequest(contextTokens: number, opts: CoverPromptOptions): PromptParts {
  const budget = budgetFor(contextTokens);
  const { text: direction, notes } = parseBracketNotes(opts.direction);
  const chapters = opts.source === "premise" ? [] : opts.source === "opening" ? opts.path.slice(0, 1) : opts.path;
  if (!opts.story.premise.trim() && chapters.length === 0 && !direction) {
    throw new Error("There's nothing to write the cover from yet: add a summary to the story, choose a chapter, or say what to show.");
  }
  if (opts.source !== "premise" && chapters.length === 0) throw new Error("The story has no chapters yet. Write the cover from the summary instead.");

  const parts = [`Story: ${opts.story.title || "(untitled)"}`];
  if (opts.story.premise.trim()) parts.push(`Premise: ${opts.story.premise.trim()}`);
  // Entries are picked by what the story (and the author's direction) mentions; those marked "always include" come first.
  const trigger = [opts.story.premise, ...chapters.map((c) => c.body), opts.direction].join("\n");
  const codex = buildCodexBlock(opts.codex, trigger, codexBudget(budget));
  if (codex) parts.push(codex);

  // The story gets what is left: the first chapter itself, or the path as the other prompts give it.
  const room = Math.max(500, budget - estimateTokens(parts.join("\n\n")));
  if (opts.source === "opening") {
    const first = chapters[0];
    const body = first.body.length <= room * 4 ? first.body : `${first.body.slice(0, room * 4)}…`;
    parts.push(`The first chapter, "${first.title}":\n${body}`);
  } else if (opts.source === "path") {
    parts.push(`The story along this path:\n${buildStorySoFar(chapters, room)}`);
  }

  parts.push(SOURCE_TASK[opts.source]);
  if (direction) parts.push(`The author wants the cover to show: ${direction}`);
  if (notes.length) parts.push(notesBlock(notes));
  return { system: SYSTEM_COVER(opts.style), message: parts.join("\n\n") };
}

export async function writeCoverPrompt(
  settings: Settings,
  opts: CoverPromptOptions & { model?: ModelRef | null; signal?: AbortSignal },
): Promise<ImagePrompt> {
  const request = coverPromptRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: "cheap",
    model: opts.model,
    signal: opts.signal,
  });
  return parseImagePrompt(reply);
}
