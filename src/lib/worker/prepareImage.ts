// The server's `prepareImage` (src/lib/prepareImage.ts is the browser's, which needs a canvas): scales a picture down so
// its longest side is at most `maxSide`, puts a white page behind a see-through one, and re-encodes it as a JPEG.
import sharp from "sharp";

export async function prepareImageOnServer(file: Blob, maxSide: number): Promise<Blob> {
  try {
    const bytes = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate() // the way its camera said it was held, as the browser applies it
      .flatten({ background: "#ffffff" })
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
  } catch {
    throw new Error("Couldn't prepare the image.");
  }
}
