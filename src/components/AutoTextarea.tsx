"use client";

import { useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// A textarea that grows to fit its text, so nothing is hidden behind a scrollbar (phones have no
// resize handle). `minHeight` still applies as the smallest size.
//
// Because the box never scrolls inside, the browser's own "keep the cursor in view" often fails on
// iPad and phones (the cursor ends up under the on-screen keyboard), so this keeps it in view itself
// after typing and when the keyboard opens.
export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = String(props.value ?? "");
  const { onInput, onFocus } = props;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measuring needs height "auto" for a moment, which shrinks the page and makes the browser pull
    // the scroll position up; put every scroll position back afterwards.
    const saved = scrollers(el).map((s) => [s, s.scrollTop] as const);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
    for (const [s, top] of saved) if (s.scrollTop !== top) s.scrollTop = top;
  }, [value]);

  // When the keyboard opens (or closes) the visible area changes size; bring the cursor back into it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const el = ref.current;
        if (el && document.activeElement === el) revealCaret(el);
      }, 120);
    };
    vv.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      vv.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <textarea
      {...props}
      ref={ref}
      onInput={(e) => {
        onInput?.(e);
        const el = e.currentTarget;
        // After React has re-rendered and the box has grown.
        requestAnimationFrame(() => revealCaret(el));
      }}
      onFocus={(e) => {
        onFocus?.(e);
        const el = e.currentTarget;
        // iOS scrolls on focus itself; check once it has settled.
        setTimeout(() => {
          if (document.activeElement === el) revealCaret(el);
        }, 350);
      }}
    />
  );
}

// The element and its ancestors that can scroll, plus the page itself.
function scrollers(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) out.push(p);
  }
  const page = document.scrollingElement;
  if (page instanceof HTMLElement && !out.includes(page)) out.push(page);
  return out;
}

// Where the cursor (the end of the selection) is, in viewport coordinates, found by laying out a
// hidden copy of the text up to the cursor.
function caretRect(el: HTMLTextAreaElement): { top: number; bottom: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement("div");
  for (const prop of [
    "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "textIndent", "textTransform", "wordSpacing", "tabSize",
  ] as const) {
    mirror.style[prop] = style[prop];
  }
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: style.wordBreak,
  });
  mirror.textContent = el.value.slice(0, el.selectionEnd ?? el.value.length);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const offset = marker.offsetTop;
  const lineHeight = marker.offsetHeight || parseFloat(style.lineHeight) || 24;
  mirror.remove();
  const top = el.getBoundingClientRect().top + offset - el.scrollTop;
  return { top, bottom: top + lineHeight };
}

// Scrolls the nearest scrolling box (or the page) just enough to show the cursor in the part of the
// screen the keyboard leaves visible.
function revealCaret(el: HTMLTextAreaElement) {
  if (document.activeElement !== el) return;
  const caret = caretRect(el);
  const vv = window.visualViewport;
  let top = vv ? vv.offsetTop : 0;
  let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const box = scrollers(el)[0];
  const isPage = box === document.scrollingElement;
  if (box && !isPage) {
    const r = box.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  const margin = 24;
  let delta = 0;
  if (caret.bottom > bottom - margin) delta = caret.bottom - (bottom - margin);
  else if (caret.top < top + margin) delta = caret.top - (top + margin);
  if (Math.abs(delta) < 1) return;
  if (box && !isPage) box.scrollTop += delta;
  else window.scrollBy(0, delta);
}
