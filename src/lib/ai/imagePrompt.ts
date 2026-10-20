// Picture prompts: turns a chapter (and the codex entries it mentions) into a prompt for an image
// model such as Stable Diffusion. The request and the reply parsing are pure; `writeImagePrompt`
// sends it from the browser like every other AI call.
import { completeChat } from "./client";
import { extractJson } from "./codexAi";
import {
  buildCodexBlock,
  budgetFor,
  codexBudget,
  estimateTokens,
  notesBlock,
  parseBracketNotes,
  type ContextChapter,
  type ContextCodexEntry,
  type PromptParts,
} from "./prompts";
import type { ImagePromptStyle, ModelRef, Settings } from "../settingsSchema";

/** Which part of the chapter the picture shows. */
export type ImageMoment = "start" | "end";

export type ImagePromptOptions = {
  story: { title: string; premise: string };
  /** The story from its first chapter down to the chapter being illustrated. */
  path: ContextChapter[];
  /** Codex entries in effect at that chapter. */
  codex: ContextCodexEntry[];
  moment: ImageMoment;
  /** What the author wants shown, optionally with "[...]" notes. Empty lets the AI choose. */
  direction: string;
  style: ImagePromptStyle;
};

export type ImagePrompt = {
  /** One or two sentences saying which moment the picture shows, for the author. */
  scene: string;
  prompt: string;
  negative: string;
};

const STYLE_RULES: Record<ImagePromptStyle, string> = {
  tags: `The image model reads comma-separated tags (Stable Diffusion XL style).
- "prompt": comma-separated tags and short phrases, most important first: how many people and who they are (e.g. "1man", "2women"), each person's visible traits (age, build, hair, eyes, skin, clothing), their pose, action and expression, then the setting, props, time of day, lighting, camera framing and composition. About 25-45 tags. No weights or brackets, no full sentences.
- "negative": comma-separated tags for things to avoid in this picture, such as lowres, bad anatomy, extra fingers, deformed hands, blurry, text, watermark, signature, plus anything that would contradict the scene.`,
  natural: `The image model reads plain descriptive English (Flux or SD3 style).
- "prompt": 3-6 sentences describing the picture as if to an illustrator: who is in it and what each person looks like (age, build, hair, eyes, skin, clothing), what they are doing and feeling, the setting and props, the time of day and lighting, and the framing.
- "negative": a short comma-separated list of things to avoid (many such models ignore it), or "" if nothing is needed.`,
};

const SYSTEM_IMAGE = (style: ImagePromptStyle) => `You turn a chapter of a story into a prompt for an AI image generator, to illustrate that chapter.
- Show one single moment, frozen in time, that a viewer can understand without reading the story.
- Describe only what can be seen. The image model has never read the story and does not know any names, so never use character or place names: describe people and places by how they look.
- Take appearance and places from the codex and the chapter. Do not invent visible details that contradict them; where nothing is said, pick plausible, unremarkable details.
- Do not describe an art style, medium or artist; the author's art style is added separately.
- Nothing written or lettered in the picture.

${STYLE_RULES[style]}

Reply with JSON only: {"scene":"","prompt":"","negative":""}
"scene" is one or two plain sentences telling the author which moment you chose.`;

const MOMENT_TASK: Record<ImageMoment, string> = {
  start: "This picture shows the start of the chapter, so it should set the scene: show where and when the chapter takes place, and who is there, near its beginning.",
  end: "This picture shows the end of the chapter, so it should show the chapter's closing moment, without giving away anything that happens later.",
};

/** The request for a picture prompt; throws if there is no chapter to illustrate. */
export function imagePromptRequest(contextTokens: number, opts: ImagePromptOptions): PromptParts {
  const chapter = opts.path.at(-1);
  if (!chapter) throw new Error("There's no chapter to illustrate.");
  const budget = budgetFor(contextTokens);
  const { text: direction, notes } = parseBracketNotes(opts.direction);

  const parts = [`Story: ${opts.story.title || "(untitled)"}`];
  if (opts.story.premise.trim()) parts.push(`Premise: ${opts.story.premise.trim()}`);
  // Entries are picked by what the chapter (and the author's direction) mentions.
  const codex = buildCodexBlock(opts.codex, `${chapter.body}\n${opts.direction}`, codexBudget(budget));
  if (codex) parts.push(codex);
  const before = opts.path.at(-2);
  const earlier = before?.path_summary || before?.summary;
  if (earlier) parts.push(`Earlier in the story:\n${earlier}`);

  // The chapter itself gets what is left; a very long one keeps the part the picture is about.
  const room = Math.max(500, budget - estimateTokens(parts.join("\n\n"))) * 4;
  const body = chapter.body.length <= room ? chapter.body : opts.moment === "start" ? `${chapter.body.slice(0, room)}…` : `…${chapter.body.slice(-room)}`;
  parts.push(`The chapter to illustrate, "${chapter.title}":\n${body}`);

  parts.push(MOMENT_TASK[opts.moment]);
  if (direction) parts.push(`The author wants the picture to show: ${direction}`);
  if (notes.length) parts.push(notesBlock(notes));
  return { system: SYSTEM_IMAGE(opts.style), message: parts.join("\n\n") };
}

const asText = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Reads the model's reply; throws if it has no prompt. */
export function parseImagePrompt(reply: string): ImagePrompt {
  const json = extractJson(reply) as Record<string, unknown>;
  const out = { scene: asText(json.scene, 1000), prompt: asText(json.prompt, 4000), negative: asText(json.negative, 2000) };
  if (!out.prompt) throw new Error("The AI's reply had no prompt in it. Try again.");
  return out;
}

/** The prompt with the story's art style added: as more tags, or as a closing sentence. */
export function withArtStyle(prompt: string, artStyle: string, style: ImagePromptStyle): string {
  const p = prompt.trim();
  const a = artStyle.replace(/\s+/g, " ").trim();
  if (!a) return p;
  if (!p) return a;
  if (style === "tags") return `${p.replace(/,\s*$/, "")}, ${a}`;
  return `${/[.!?]$/.test(p) ? p : `${p}.`} ${/[.!?]$/.test(a) ? a : `${a}.`}`;
}

export async function writeImagePrompt(
  settings: Settings,
  opts: ImagePromptOptions & { model?: ModelRef | null; signal?: AbortSignal },
): Promise<ImagePrompt> {
  const request = imagePromptRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: "cheap",
    model: opts.model,
    signal: opts.signal,
  });
  return parseImagePrompt(reply);
}
