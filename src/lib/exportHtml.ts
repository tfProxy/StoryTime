import { contentNotes } from "./contentNotes";
import { noteText } from "./contentNotesRoll";
import { finishedBranches, routeTo, type StoryExport } from "./export";

// A single self-contained HTML file that plays the story in any browser: no server, no network, no
// libraries. It remembers which chapters the reader has seen (in that browser's localStorage, keyed
// by story) and can forget them again. Only finished branches are included, like the Twine export.

/** h and f are the header and footer pictures as data: URIs, when the chapter has them. */
type Page = { t: string; b: string; c: [string, string, string?][]; p: string | null; h?: string; f?: string };

/** Each chapter's pictures as data: URIs, so the exported file works offline. */
function imageUris(data: StoryExport) {
  const uris = new Map<string, { header?: string; footer?: string }>();
  for (const i of data.images) {
    const entry = uris.get(i.chapter_id) ?? {};
    entry[i.slot] = `data:${i.type};base64,${i.data}`;
    uris.set(i.chapter_id, entry);
  }
  return uris;
}

/** JSON that is safe to put inside a <script> element. */
const scriptJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STYLE = `
:root { --bg:#fbfaf7; --fg:#1d1c1a; --muted:#6b675f; --card:#fff; --line:#dcd8cf; --accent:#2f5d8a; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#16171a; --fg:#e8e6e1; --muted:#9a968d; --card:#1f2024; --line:#35363b; --accent:#8db8e6; }
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:18px/1.65 Georgia, "Times New Roman", serif; }
main { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0.5rem 0; }
h2 { font-size: 1.5rem; line-height: 1.25; margin: 0.25rem 0 0.75rem; }
.meta { color: var(--muted); font-size: 0.9rem; font-family: system-ui, sans-serif; }
.prose p { margin: 0 0 1em; white-space: pre-line; }
.choices { display: grid; gap: 0.6rem; margin: 1.5rem 0; }
button { font: 1rem system-ui, sans-serif; padding: 0.7rem 1rem; border-radius: 8px; border: 1px solid var(--accent);
  background: var(--accent); color: var(--bg); cursor: pointer; text-align: left; }
button.secondary { background: transparent; color: var(--accent); }
button.choice { background: var(--card); color: var(--fg); border-color: var(--line); }
button.choice:hover, button.choice:focus-visible { border-color: var(--accent); }
button.choice .seen { color: var(--muted); font-size: 0.8rem; margin-left: 0.5rem; }
button.choice .note { display: block; color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; }
nav { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1.5rem 0 0; }
blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid var(--line); color: var(--muted); white-space: pre-line; }
.end { text-align: center; color: var(--muted); font-style: italic; margin: 2rem 0; }
.chapter-image { display: block; max-width: 100%; max-height: 70vh; height: auto; margin: 1rem auto; border-radius: 6px; }
`;

// Written without template literals so it can sit inside one.
const SCRIPT = String.raw`
(function () {
  var data = JSON.parse(document.getElementById("story-data").textContent);
  var KEY = "storytime-offline:" + data.id;
  var root = document.getElementById("app");
  var total = Object.keys(data.pages).length;

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "{}");
      return { seen: s.seen && typeof s.seen === "object" ? s.seen : {}, last: typeof s.last === "string" ? s.last : null };
    } catch (e) { return { seen: {}, last: null }; }
  }
  var state = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: just don't remember */ } }
  function seenCount() { return Object.keys(state.seen).filter(function (id) { return data.pages[id]; }).length; }

  function el(tag, props, children) {
    var n = document.createElement(tag);
    for (var k in props || {}) {
      if (k === "class") n.className = props[k];
      else if (k === "onclick") n.addEventListener("click", props[k]);
      else n.setAttribute(k, props[k]);
    }
    (children || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function paragraphs(text) {
    return text.split(/\n\s*\n/).filter(function (p) { return p.trim(); }).map(function (p) { return el("p", {}, [p.trim()]); });
  }
  function go(id) { location.hash = id; }

  function showTitle() {
    document.title = data.title;
    var kids = [el("h1", {}, [data.title])];
    if (data.premise) kids.push(el("blockquote", {}, [data.premise]));
    var resume = state.last && data.pages[state.last] && state.last !== data.start;
    kids.push(el("div", { class: "choices" }, [
      el("button", { onclick: function () { go(data.start); } }, [resume ? "Start from the beginning" : "Start reading"])
    ].concat(resume ? [el("button", { class: "choice", onclick: function () { go(state.last); } }, ["Continue where you left off: " + data.pages[state.last].t])] : [])));
    var n = seenCount();
    if (n > 0) {
      kids.push(el("p", { class: "meta" }, ["You have read " + n + " of " + total + " chapters. "]));
      kids[kids.length - 1].appendChild(el("button", { class: "secondary", onclick: reset }, ["Forget what I have read"]));
    }
    root.replaceChildren.apply(root, kids);
  }

  function reset() {
    if (!confirm("Forget which chapters you have read and where you left off?")) return;
    state = { seen: {}, last: null };
    save();
    if (location.hash) location.hash = ""; else render();
  }

  function showChapter(id) {
    var page = data.pages[id];
    state.seen[id] = 1;
    state.last = id;
    save();
    document.title = page.t + " \u2013 " + data.title;
    var kids = [];
    if (page.h) kids.push(el("img", { class: "chapter-image chapter-image-header", alt: "", src: page.h }));
    kids.push(el("h2", {}, [page.t]));
    kids.push(el("div", { class: "prose" }, paragraphs(page.b)));
    if (page.f) kids.push(el("img", { class: "chapter-image chapter-image-footer", alt: "", src: page.f }));
    if (page.c.length) {
      kids.push(el("div", { class: "choices" }, page.c.map(function (c) {
        var seen = state.seen[c[1]];
        var inner = [c[0]].concat(seen ? [el("span", { class: "seen" }, ["(read)"])] : []);
        if (c[2]) inner.push(el("span", { class: "note" }, [c[2]]));
        return el("button", { class: "choice", onclick: function () { go(c[1]); } }, inner);
      })));
    } else {
      kids.push(el("p", { class: "end" }, ["The end of this branch."]));
    }
    var nav = [];
    if (page.p) nav.push(el("button", { class: "secondary", onclick: function () { go(page.p); } }, ["\u2190 Previous chapter"]));
    if (id !== data.start) nav.push(el("button", { class: "secondary", onclick: function () { go(data.start); } }, ["Back to the start"]));
    nav.push(el("button", { class: "secondary", onclick: function () { location.hash = ""; } }, ["Title page"]));
    kids.push(el("nav", {}, nav));
    root.replaceChildren.apply(root, kids);
    window.scrollTo(0, 0);
  }

  function render() {
    var id = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (id && data.pages[id]) showChapter(id); else showTitle();
  }
  window.addEventListener("hashchange", render);
  render();
})();
`;

/** One route through the story as a static, continuous HTML page (no script). Null if the chapter isn't in the story. */
export function toPathHtml(data: StoryExport, chapterId: string): string | null {
  const found = routeTo(data, chapterId);
  if (!found) return null;
  const { route, viaOf, toBeContinued } = found;
  const paras = (text: string) =>
    text
      .split(/\n\s*\n/)
      .filter((p) => p.trim())
      .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
      .join("\n");
  const uris = imageUris(data);
  const img = (id: string, slot: "header" | "footer") => {
    const uri = uris.get(id)?.[slot];
    return uri ? `<img class="chapter-image chapter-image-${slot}" alt="" src="${escapeHtml(uri)}">` : "";
  };
  const s = data.story;
  const body = [
    `<h1>${escapeHtml(s.title)}</h1>`,
    s.premise.trim() ? `<blockquote>${escapeHtml(s.premise.trim())}</blockquote>` : "",
    ...route.map((c, i) => {
      const via = viaOf(c);
      return `<section>
${via ? `<p class="via">${escapeHtml(via.label)}</p>` : ""}
${img(c.id, "header")}
<h2>${i + 1}. ${escapeHtml(c.title)}</h2>
<div class="prose">
${paras(c.body)}
</div>
${img(c.id, "footer")}
</section>`;
    }),
    `<p class="end">${toBeContinued ? "…to be continued." : "The end."}</p>`,
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(s.title)}</title>
<style>${STYLE}
section { margin-top: 2.5rem; }
.via { color: var(--muted); font-style: italic; margin: 0 0 0.5rem; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export function toHtml(data: StoryExport): string {
  const { chapters, childBy, choicesBy, leadsToKept } = finishedBranches(data);
  const pages: Record<string, Page> = {};
  const parentOf = new Map<string, string>();
  const uris = imageUris(data);
  const notes = contentNotes(data.story.id);
  for (const c of chapters) {
    const list: [string, string, string?][] = [];
    for (const ch of choicesBy.get(c.id) ?? []) {
      if (!leadsToKept(ch)) continue;
      const child = childBy.get(ch.id)!;
      const note = noteText(notes.get(child.id));
      list.push(note ? [ch.label, child.id, note] : [ch.label, child.id]);
      parentOf.set(child.id, c.id);
    }
    const pictures = uris.get(c.id);
    pages[c.id] = {
      t: c.title, b: c.body.trim(), c: list, p: null,
      ...(pictures?.header ? { h: pictures.header } : {}),
      ...(pictures?.footer ? { f: pictures.footer } : {}),
    };
  }
  for (const [child, parent] of parentOf) pages[child].p = parent;

  const payload = { id: data.story.id, title: data.story.title, premise: data.story.premise.trim(), start: chapters[0].id, pages };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.story.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main id="app"><noscript><p>This story needs JavaScript to be read in the browser.</p></noscript></main>
<script id="story-data" type="application/json">${scriptJson(payload)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
