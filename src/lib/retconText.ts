// Finding and replacing the passages a retcon changes. The AI copies a passage from the chapter ("old") and gives its
// replacement ("new"). Models often copy with straight quotes for curly ones, a hyphen for a dash, or different spacing,
// so a passage is found by comparing both texts with those differences evened out, and the chapter's own spelling of
// it is what gets replaced. Pure: shared by the server and the browser.

export type RetconEdit = { old: string; new: string };

const CHAR_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
  "–": "-", "—": "-",
};

/** The text evened out (see above, and lower case), with where each of its characters came from in the original. */
function evened(text: string): { s: string; at: number[] } {
  let s = "";
  const at: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!space && s.length > 0) {
        s += " ";
        at.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    if (ch === "…") {
      for (let k = 0; k < 3; k++) {
        s += ".";
        at.push(i);
      }
      continue;
    }
    s += (CHAR_MAP[ch] ?? ch).toLowerCase();
    at.push(i);
  }
  if (s.endsWith(" ")) {
    s = s.slice(0, -1);
    at.pop();
  }
  return { s, at };
}

/**
 * The chapter's own spelling of `passage`, or null when it isn't in `text`. An exact match is used as it is; otherwise
 * the first match with quotes, dashes, spacing and case evened out.
 */
export function findPassage(passage: string, text: string): string | null {
  if (!passage.trim()) return null;
  if (text.includes(passage)) return passage;
  const p = evened(passage).s;
  if (!p) return null;
  const t = evened(text);
  const start = t.s.indexOf(p);
  if (start < 0) return null;
  const from = t.at[start];
  const lastChar = t.at[start + p.length - 1];
  // A "…" in the text stands for three evened characters: take all of it.
  return text.slice(from, lastChar + 1);
}

/**
 * Applies the edits to the texts (the chapter's body, then its summary): every occurrence of each passage is replaced
 * in the first text that has it. `missing` lists the edits found in none of them.
 */
export function applyEdits(texts: string[], edits: RetconEdit[]): { texts: string[]; missing: RetconEdit[] } {
  const out = [...texts];
  const missing: RetconEdit[] = [];
  for (const e of edits) {
    let done = false;
    for (let i = 0; i < out.length && !done; i++) {
      const found = findPassage(e.old, out[i]);
      if (found === null) continue;
      out[i] = out[i].split(found).join(e.new);
      done = true;
    }
    if (!done) missing.push(e);
  }
  return { texts: out, missing };
}
