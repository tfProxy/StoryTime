// Chapter text is plain text. Blank lines split paragraphs; React escapes everything.
export default function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  return (
    <div className="prose">
      {paragraphs.map((p, i) => (
        <p key={i} style={{ whiteSpace: "pre-line" }}>
          {p.trim()}
        </p>
      ))}
    </div>
  );
}
