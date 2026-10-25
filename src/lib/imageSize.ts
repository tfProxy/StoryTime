// The pixel size of a PNG, JPEG or WebP, read from its header, for code that has no canvas (the server). No dependency.

export type ImageSize = { width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function png(b: Uint8Array): ImageSize | null {
  // 8-byte signature, then the IHDR chunk: length, "IHDR", width, height.
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++; // padding
      continue;
    }
    // Standalone markers have no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image, or the scan: no frame header found
    const length = u16be(b, i + 2);
    // Start-of-frame markers; C4 (Huffman table), C8 (reserved) and CC (arithmetic conditioning) are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) return null;
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const kind = ascii(b, 12, 4);
  if (kind === "VP8 ") {
    // Lossy: a 3-byte frame tag, the start code 9d 01 2a, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (kind === "VP8L") {
    // Lossless: signature 0x2f, then 14-bit width-1 and height-1 packed together.
    if (b[20] !== 0x2f) return null;
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") {
    // Extended: 24-bit canvas width-1 and height-1.
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** The size of the picture, or null when the bytes are not a PNG, JPEG or WebP, or are cut off. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  let size: ImageSize | null = null;
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") size = png(bytes);
  else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) size = jpeg(bytes);
  else if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") size = webp(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}
