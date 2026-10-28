// A word-level diff for showing exactly what a codex suggestion changes. Text is cut into words and the whitespace
// between them; the longest common run of words is kept as "same", the rest is "del" (only in `before`) or "add"
// (only in `after`). Whitespace sticks to the word before it, so a changed word never leaves a stray space behind and
// punctuation that is part of a word ("Mira's", "gone.") counts as a change of that word.

export type DiffSegment = { type: "same" | "add" | "del"; text: string };

/** Each word with the whitespace around it (leading whitespace goes with the first word). */
function pieces(s: string): string[] {
  return s.match(/\s+$|\s*\S+\s*/g) ?? [];
}

const key = (p: string) => p.trim();

export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = pieces(before);
  const b = pieces(after);
  // Longest common subsequence table over the words.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = key(a[i]) === key(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffSegment[] = [];
  const push = (type: DiffSegment["type"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]) === key(b[j])) {
      push("same", b[j]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", a[i++]);
    } else {
      push("add", b[j++]);
    }
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("add", b[j++]);
  return out;
}
