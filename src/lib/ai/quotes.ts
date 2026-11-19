// Checking that a quote an AI gave is really in the chapter (facts, codex checks, fleshing out entries).

/** Makes text comparable: straight quotes and dashes, one space between words, no case. */
function squash(s: string): string {
  return s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True if the quote appears in the chapter, ignoring whitespace, curly quotes and case. */
export function quoteInText(quote: string, body: string): boolean {
  const q = squash(quote).replace(/^\.\.\.|\.\.\.$/g, "").trim();
  if (!q) return false;
  return squash(body).includes(q);
}

type Word = { w: string; start: number; end: number };

/** A text's words, lower case with straight apostrophes, and where each one is in the text. */
function wordsOf(s: string): Word[] {
  return [...s.matchAll(/[\p{L}\p{N}]+(?:['’‘][\p{L}\p{N}]+)*/gu)].map((m) => ({ w: m[0].replace(/[’‘]/g, "'").toLowerCase(), start: m.index, end: m.index + m[0].length }));
}

/** Pieces of this many words or more may differ a little from the chapter; shorter ones must match exactly. */
const FUZZY_MIN_WORDS = 6;
/** The share of a long piece's words that must be in the chapter, in order. */
const FUZZY_SHARE = 0.8;

/** Where `piece` is in `body` (word indexes, inclusive), searching from word `from`: exactly, or else nearly. */
function findPiece(piece: string[], body: Word[], from: number): [number, number] | null {
  const n = piece.length;
  for (let i = from; i + n <= body.length; i++) {
    let j = 0;
    while (j < n && body[i + j].w === piece[j]) j++;
    if (j === n) return [i, i + n - 1];
  }
  if (n < FUZZY_MIN_WORDS) return null;
  // Nearly: the longest run of the piece's words, in order, in a window that starts on one of its first words.
  const need = Math.ceil(n * FUZZY_SHARE);
  const span = n + Math.ceil(n / 4);
  const heads = new Set(piece.slice(0, 3));
  let best: { count: number; at: [number, number] } | null = null;
  for (let i = from; i < body.length; i++) {
    if (!heads.has(body[i].w)) continue;
    const win = body.slice(i, i + span).map((x) => x.w);
    const lcs = Array.from({ length: n + 1 }, () => new Array<number>(win.length + 1).fill(0));
    for (let a = n - 1; a >= 0; a--) {
      for (let b = win.length - 1; b >= 0; b--) lcs[a][b] = piece[a] === win[b] ? lcs[a + 1][b + 1] + 1 : Math.max(lcs[a + 1][b], lcs[a][b + 1]);
    }
    if (lcs[0][0] < need || (best && lcs[0][0] <= best.count)) continue;
    // Walk the table for the first and last window words that matched.
    let a = 0, b = 0, first = -1, last = -1;
    while (a < n && b < win.length) {
      if (piece[a] === win[b]) {
        if (first < 0) first = b;
        last = b;
        a++;
        b++;
      } else if (lcs[a + 1][b] >= lcs[a][b + 1]) a++;
      else b++;
    }
    best = { count: lcs[0][0], at: [i + first, i + last] };
  }
  return best?.at ?? null;
}

/**
 * The chapter's own words for a quote the AI gave, or null when the quote isn't in the chapter. Small models rarely
 * copy exactly: they join pieces of the chapter with "..." and drop or change a word. Each piece (of three words or
 * more) has to be found, in order, and long pieces may differ by a fifth of their words. What comes back is the
 * passage from the first piece to the last, as the chapter has it, or (when that is longer than `max`) the pieces
 * joined with " … ".
 */
export function matchQuote(quote: string, body: string, max = 500): string | null {
  const pieces = quote
    .split(/\.\.\.|…/)
    .map((p) => wordsOf(p).map((x) => x.w))
    .filter((p) => p.length >= 3);
  if (!pieces.length) return quoteInText(quote, body) ? quote.trim().slice(0, max) : null;
  const words = wordsOf(body);
  const found: [number, number][] = [];
  let from = 0;
  for (const p of pieces) {
    const at = findPiece(p, words, from);
    if (!at) return null;
    found.push(at);
    from = at[1] + 1;
  }
  const start = words[found[0][0]].start;
  const end = words[found.at(-1)![1]].end;
  if (end - start <= max) return body.slice(start, end);
  return found.map(([a, b]) => body.slice(words[a].start, words[b].end)).join(" … ").slice(0, max);
}
