// A story's book cover: its uploaded image, or a generated one when there is none.
// The generated cover is drawn from the story's id, so a story keeps the same look every time.

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A small deterministic random-number generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Placeholder({ id, title }: { id: string; title: string }) {
  const seed = hash(id);
  const rand = rng(seed);
  const hue = seed % 360;
  const hue2 = (hue + 35 + Math.floor(rand() * 40)) % 360;
  const shapes = Array.from({ length: 4 }, () => ({
    cx: Math.round(rand() * 200),
    cy: Math.round(rand() * 300),
    r: Math.round(40 + rand() * 80),
    o: 0.08 + rand() * 0.12,
  }));
  const letter = ([...title.trim()][0] ?? "?").toUpperCase();
  const gid = `cover-${id}`;
  return (
    <svg viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 50% 34%)`} />
          <stop offset="1" stopColor={`hsl(${hue2} 55% 18%)`} />
        </linearGradient>
      </defs>
      <rect width="200" height="300" fill={`url(#${gid})`} />
      {shapes.map((s, i) => (
        <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="#fff" opacity={s.o} />
      ))}
      <rect x="14" y="14" width="172" height="272" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="1.5" />
      <rect x="20" y="20" width="160" height="260" fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.75" />
      <text
        x="100"
        y="168"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="110"
        fontWeight="700"
        fill="#fff"
        fillOpacity="0.88"
      >
        {letter}
      </text>
      <path d="M60 214h80" stroke="#fff" strokeOpacity="0.6" strokeWidth="1.5" />
    </svg>
  );
}

export default function StoryCover({ story }: { story: { id: string; title: string; cover_version: number | null } }) {
  return (
    <div className="cover">
      {story.cover_version ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/stories/${story.id}/cover?v=${story.cover_version}`} alt="" loading="lazy" />
      ) : (
        <Placeholder id={story.id} title={story.title} />
      )}
    </div>
  );
}
