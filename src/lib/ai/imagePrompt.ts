// Picture prompts: turns a chapter (and the codex entries it mentions) into a prompt for an image
// model such as Stable Diffusion. The request and the reply parsing are pure; `writeImagePrompt`
// sends it from the browser like every other AI call.
import { completeChat, type AiSourceIds } from "./client";
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
export type ImageMoment = "start" | "middle" | "end";

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
  /** Text the author always includes in the chapter's prompt; the AI is told not to repeat it. */
  fixed?: string;
};

export type ImagePrompt = {
  /** One or two sentences saying which moment the picture shows, for the author. */
  scene: string;
  prompt: string;
  negative: string;
};

/** Rules every tag prompt follows, whatever tags the model knows. */
const TAG_HYGIENE = `- Say each thing once. Never repeat a trait in other words ("blonde hair" and "golden hair", "smile" and "smiling", "muscular" and "strong build"): every repeat makes the model exaggerate it.
- Only what is visible at the chosen framing: no shoes in a close-up, no eye colour in a wide shot.
- No mood words or praise ("ethereal", "breathtaking", "intricate", "dramatic", "stunning", "beautiful"), no quality tags (masterpiece, best quality, score_9); the author adds those.
- With two or more people, describe the main one fully and give each other person only the two or three traits that tell them apart; the model mixes up whose traits are whose.
- No weights or brackets, no full sentences.`;

/** How the prompt is written for each kind of image model; the cover and codex prompts use the same. */
export const STYLE_RULES: Record<ImagePromptStyle, string> = {
  tags: `The image model reads comma-separated tags (Stable Diffusion XL style).
- "prompt": comma-separated tags and short plain phrases, most important first: how many people and who they are (e.g. "1man", "2women"), the camera framing and angle, each person's visible traits (age, build, hair, eyes, skin, clothing), their pose, action and expression, then the setting, props, time of day and lighting. About 20-35 tags.
${TAG_HYGIENE}
- "negative": comma-separated tags for things to avoid in this picture, such as lowres, bad anatomy, extra fingers, deformed hands, blurry, text, watermark, signature, plus anything that would contradict the scene.`,
  booru: `The image model was trained on Danbooru and e621 tags (Illustrious, NoobAI or Pony style) and understands little else.
- "prompt": comma-separated tags exactly as they are written on Danbooru (or e621 for animals and non-human characters), with spaces instead of underscores. One idea per tag; no descriptive phrases. About 15-30 tags, in this order:
  1. who is there: "solo" for one person, and the count tags ("1girl", "1boy", "2girls", "1boy, 1girl", "multiple boys", "no humans"); for animal or non-human characters the e621 tags for them ("anthro", "feral", the species, "scales", "fur").
  2. framing and camera angle: one of "portrait", "close-up", "upper body", "cowboy shot", "full body", "wide shot", and if it helps an angle such as "from above", "from below", "from side", "from behind", "dutch angle", "pov".
  3. each person's visible traits as single tags: hair colour and length, hairstyle, eye colour, build, clothing items ("long hair", "brown hair", "ponytail", "blue eyes", "white shirt", "black jacket", "beard").
  4. pose, action, expression and gaze ("sitting", "holding sword", "running", "smile", "frown", "crying", "looking at viewer", "looking away", "open mouth").
  5. the setting, props, time and light as tags ("indoors", "kitchen", "forest", "night", "rain", "sunlight", "candle", "table").
${TAG_HYGIENE}
- "negative": a few tags for things that would contradict this picture, such as "multiple girls" when only one woman is there, "outdoors" for a room, plus lowres, bad anatomy, bad hands, text, watermark.`,
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
- Choose the framing the moment needs, not full body by default: a close-up or portrait for a feeling or a quiet beat, upper body or cowboy shot for a conversation, full body only when the whole figure matters (a fight, an entrance, an outfit), a wide shot when the place matters more than the people. A low or high angle, a view from behind or over a shoulder can make a moment stronger. Name the framing in the prompt.

${STYLE_RULES[style]}

Reply with JSON only: {"scene":"","prompt":"","negative":""}
"scene" is one or two plain sentences telling the author which moment you chose.`;

const MOMENT_TASK: Record<ImageMoment, string> = {
  start: "This picture shows the start of the chapter, so it should set the scene: show where and when the chapter takes place, and who is there, near its beginning.",
  middle: "This picture shows the middle of the chapter, so it should show a key moment from around the middle of the chapter, not its opening or its ending.",
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
  let body = chapter.body;
  if (body.length > room) {
    if (opts.moment === "start") body = `${body.slice(0, room)}…`;
    else if (opts.moment === "middle") {
      const from = Math.max(0, Math.floor((body.length - room) / 2));
      body = `…${body.slice(from, from + room)}…`;
    } else body = `…${body.slice(-room)}`;
  }
  parts.push(`The chapter to illustrate, "${chapter.title}":\n${body}`);

  parts.push(MOMENT_TASK[opts.moment]);
  if (direction) parts.push(`The author wants the picture to show: ${direction}`);
  if (notes.length) parts.push(notesBlock(notes));
  const fixed = opts.fixed?.trim();
  if (fixed) parts.push(`The author always adds this to the prompt, so the picture will already have it. Do not repeat or contradict it in "prompt": ${fixed}`);
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

/** Whether prompts in this style are comma-separated tags (plain or booru) rather than sentences. */
export const isTagStyle = (style: ImagePromptStyle) => style !== "natural";

/** The prompt with the story's art style added: as more tags, or as a closing sentence. */
export function withArtStyle(prompt: string, artStyle: string, style: ImagePromptStyle): string {
  const p = prompt.trim();
  const a = artStyle.replace(/\s+/g, " ").trim();
  if (!a) return p;
  if (!p) return a;
  if (isTagStyle(style)) return `${p.replace(/,\s*$/, "")}, ${a}`;
  return `${/[.!?]$/.test(p) ? p : `${p}.`} ${/[.!?]$/.test(a) ? a : `${a}.`}`;
}

const tagList = (text: string) => text.split(/[,\n]/).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
/** A tag as compared for duplicates: ignoring case, underscores, brackets and a ":1.2" weight. */
const tagKey = (tag: string) => tag.toLowerCase().replace(/^[([{\s]+|[)\]}\s]+$/g, "").replace(/:\s*-?[\d.]+$/, "").replace(/[_\s]+/g, " ").trim();

/** Tags `prompt` has that none of `given` has. Sentence prompts are left as they are. */
export function withoutGiven(prompt: string, given: string[], style: ImagePromptStyle): string {
  const have = new Set(given.flatMap(tagList).map(tagKey));
  if (!isTagStyle(style) || have.size === 0) return prompt.trim();
  return tagList(prompt).filter((t) => !have.has(tagKey(t))).join(", ");
}

/**
 * The prompt parts put together in order: tags are joined with commas, leaving out any a part already
 * has; sentences are joined with spaces, leaving out a part the text already contains.
 */
export function combinePrompts(style: ImagePromptStyle, ...parts: string[]): string {
  if (isTagStyle(style)) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of parts.flatMap(tagList)) {
      const key = tagKey(tag);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
    return out.join(", ");
  }
  let out = "";
  for (const raw of parts) {
    const part = raw.replace(/\s+/g, " ").trim();
    if (!part || out.toLowerCase().includes(part.toLowerCase().replace(/[.!?]+$/, ""))) continue;
    out = out ? `${/[.!?]$/.test(out) ? out : `${out}.`} ${part}` : part;
  }
  return out;
}

export async function writeImagePrompt(
  settings: Settings,
  opts: ImagePromptOptions & { model?: ModelRef | null; signal?: AbortSignal; source?: AiSourceIds },
): Promise<ImagePrompt> {
  const request = imagePromptRequest(settings.contextTokens, opts);
  const reply = await completeChat(settings, {
    system: request.system,
    messages: [{ role: "user", content: request.message }],
    role: "cheap",
    model: opts.model,
    signal: opts.signal,
    source: { label: "Picture prompt", ...opts.source },
  });
  return parseImagePrompt(reply);
}
