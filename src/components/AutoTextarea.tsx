"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// A textarea that grows to fit its text, so nothing is hidden behind a scrollbar (phones have no
// resize handle). `minHeight` still applies as the smallest size.
export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = String(props.value ?? "");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea {...props} ref={ref} />;
}
