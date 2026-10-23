// What a Refine "Go" sends, worked out from the editor's state. Pure code (no React, no browser), so it can be tested.
import { combinePrompts } from "../ai/imagePrompt";
import type { DrawPreset } from "../comfy/presets";
import type { MaskState } from "../mask";
import type { RefineState } from "../refineHistory";

/** A short stable hash of some text (djb2, base 36): names a distinct picture or mask, not for security. */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}${s.length.toString(36)}`;
}

/**
 * The prompt and negative a job is sent with, put together exactly as the Illustrate page does when it asks for a
 * picture: the preset's text, the Always add text, then the prompt box; the negative box, then the preset's negative.
 * With nothing to add, the boxes are used as typed.
 */
export function sentPrompts(draw: Pick<DrawPreset, "prompt" | "negative" | "promptStyle">, always: string, prompt: string, negative: string): { prompt: string; negative: string } {
  return {
    prompt: draw.prompt.trim() || always.trim() ? combinePrompts(draw.promptStyle, draw.prompt, always, prompt) : prompt,
    negative: draw.negative.trim() ? combinePrompts(draw.promptStyle, negative, draw.negative) : negative,
  };
}

/** Whether the paint layer is part of the picture that is sent: only while it is visible and has strokes. */
export const paintUsed = (s: RefineState) => s.paintVisible && s.paint.length > 0;

/** The mask a job uses, or null: only a visible mask with strokes counts (hidden = not used). */
export const maskUsed = (s: RefineState): MaskState | null => (s.maskVisible && s.mask.strokes.length > 0 ? s.mask : null);

/** Names the picture that is sent (the base plus the paint as seen): the same picture and paint give the same key, so ComfyUI's upload is reused. */
export const sentPictureKey = (sessionId: string, s: RefineState) => `refine:${sessionId}:${s.base}:${paintUsed(s) ? hashText(JSON.stringify(s.paint)) : "clean"}`;

/** Names a mask: changes whenever its strokes, soft edge or inversion do, and stays the same otherwise. */
export const maskId = (m: MaskState) => `refine-${hashText(JSON.stringify([m.strokes, m.softness, m.inverted]))}`;
