// imageSize: the size of a PNG, JPEG or WebP read from hand-built headers.
import { imageSize } from "../../src/lib/imageSize.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

const png = (w: number, h: number) =>
  new Uint8Array([0x89, ...text("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...text("IHDR"), ...be32(w), ...be32(h), 8, 2, 0, 0, 0]);

// A JPEG with an APP0 segment (length 16) before the frame header, as real files have.
const jpeg = (w: number, h: number, sof = 0xc0) =>
  new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, ...be16(16), ...text("JFIF"), 0, 1, 1, 0, ...be16(1), ...be16(1), 0, 0,
    0xff, 0xdb, ...be16(4), 0, 0, // a (tiny) table, to be skipped by its length
    0xff, sof, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);

const riff = (kind: string, body: number[]) => new Uint8Array([...text("RIFF"), ...be32(0), ...text("WEBP"), ...text(kind), ...be32(body.length), ...body]);
const webpLossy = (w: number, h: number) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0, 0, 0]);
const webpLossless = (w: number, h: number) => {
  const bits = ((w - 1) | ((h - 1) << 14)) >>> 0;
  return riff("VP8L", [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0, 0, 0, 0, 0]);
};
const webpExtended = (w: number, h: number) => riff("VP8X", [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1), 0, 0, 0, 0]);

ok(same(imageSize(png(96, 60)), { width: 96, height: 60 }), "PNG");
ok(same(imageSize(png(1024, 1536)), { width: 1024, height: 1536 }), "PNG, larger than 255 each way");
ok(same(imageSize(jpeg(640, 480)), { width: 640, height: 480 }), "JPEG (baseline), after other segments");
ok(same(imageSize(jpeg(1200, 800, 0xc2)), { width: 1200, height: 800 }), "JPEG (progressive)");
ok(same(imageSize(webpLossy(512, 768)), { width: 512, height: 768 }), "WebP, lossy");
ok(same(imageSize(webpLossless(300, 200)), { width: 300, height: 200 }), "WebP, lossless");
ok(same(imageSize(webpLossless(16384, 1)), { width: 16384, height: 1 }), "WebP, lossless at the largest size");
ok(same(imageSize(webpExtended(2000, 1500)), { width: 2000, height: 1500 }), "WebP, extended");

ok(imageSize(new Uint8Array()) === null, "empty bytes give null");
ok(imageSize(new TextEncoder().encode("not a picture at all, just text")) === null, "text gives null");
ok(imageSize(png(96, 60).subarray(0, 20)) === null, "a cut-off PNG gives null");
ok(imageSize(jpeg(640, 480).subarray(0, 30)) === null, "a JPEG cut off before its frame header gives null");
ok(imageSize(webpLossy(512, 768).subarray(0, 20)) === null, "a cut-off WebP gives null");
ok(imageSize(png(0, 60)) === null, "a zero width gives null");
// A DHT table (C4) must not be taken for a frame header.
const dht = new Uint8Array([0xff, 0xd8, 0xff, 0xc4, ...be16(4), 0, 0, 0xff, 0xd9]);
ok(imageSize(dht) === null, "a JPEG with no frame header gives null");
