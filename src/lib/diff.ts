// A word-level diff, for comparing two drafts of a chapter.

export type DiffPart = { type: "same" | "add" | "del"; text: string };

/** Beyond this many word pairs the exact diff costs too much; the texts are then shown as one removal and one addition. */
const MAX_CELLS = 4_000_000;

const tokens = (s: string) => s.match(/\s+|\S+/g) ?? [];

function push(parts: DiffPart[], type: DiffPart["type"], text: string) {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.type === type) last.text += text;
  else parts.push({ type, text });
}

/** What changed going from `a` to `b`: text only in `a` is "del", only in `b` is "add". */
export function diffWords(a: string, b: string): DiffPart[] {
  const x = tokens(a);
  const y = tokens(b);
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const parts: DiffPart[] = [];
  push(parts, "same", x.slice(0, start).join(""));

  const n = endX - start;
  const m = endY - start;
  if (n * m > MAX_CELLS) {
    push(parts, "del", x.slice(start, endX).join(""));
    push(parts, "add", y.slice(start, endY).join(""));
  } else {
    // lcs[i][j]: length of the longest common run of x[start+i..] and y[start+j..].
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          x[start + i] === y[start + j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[start + i] === y[start + j]) {
        push(parts, "same", x[start + i]);
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
        push(parts, "del", x[start + i++]);
      } else {
        push(parts, "add", y[start + j++]);
      }
    }
    while (i < n) push(parts, "del", x[start + i++]);
    while (j < m) push(parts, "add", y[start + j++]);
  }

  push(parts, "same", x.slice(endX).join(""));
  return parts;
}
