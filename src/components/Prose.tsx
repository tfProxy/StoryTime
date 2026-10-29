import { Fragment } from "react";
import { middleBreak, splitParagraphs } from "@/lib/imageSlots";

// Chapter text is plain text. Blank lines split paragraphs; React escapes everything.
// `middle` (the chapter's middle picture) goes at the paragraph break nearest the middle of the text.
export default function Prose({ text, middle }: { text: string; middle?: React.ReactNode }) {
  const paragraphs = splitParagraphs(text);
  const at = middle ? middleBreak(paragraphs) : -1;
  return (
    <div className="prose">
      {paragraphs.map((p, i) => (
        <Fragment key={i}>
          {i === at && middle}
          <p style={{ whiteSpace: "pre-line" }}>{p.trim()}</p>
        </Fragment>
      ))}
      {at >= paragraphs.length && middle}
    </div>
  );
}
