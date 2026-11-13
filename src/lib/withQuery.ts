/** `path` with a page's search params (as Next.js hands them to a page) after it, so a redirect keeps the query. */
export function withQuery(path: string, query: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
