// The server's prepareImage: scaled down to a longest side, flattened onto white, re-encoded as a JPEG.
import sharp from "sharp";
import { prepareImageOnServer } from "../../src/lib/worker/prepareImage.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const png = async (width: number, height: number, alpha = 1) =>
  new Blob([new Uint8Array(await sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha } } }).png().toBuffer())], { type: "image/png" });
const info = async (blob: Blob) => sharp(Buffer.from(await blob.arrayBuffer())).metadata();

const big = await prepareImageOnServer(await png(3200, 1000), 1600);
const bigInfo = await info(big);
ok(big.type === "image/jpeg" && bigInfo.format === "jpeg", "a picture comes out as a JPEG");
ok(bigInfo.width === 1600 && bigInfo.height === 500, `a wide picture is scaled to 1600 on its longest side (${bigInfo.width}x${bigInfo.height})`);
const tall = await info(await prepareImageOnServer(await png(1000, 2000), 1600));
ok(tall.width === 800 && tall.height === 1600, "a tall one by its height");
const small = await info(await prepareImageOnServer(await png(96, 60), 1600));
ok(small.width === 96 && small.height === 60, "a small picture is not enlarged");

// See-through pixels get a white page behind them.
const flat = await prepareImageOnServer(await png(8, 8, 0), 1600);
const px = await sharp(Buffer.from(await flat.arrayBuffer())).raw().toBuffer();
ok(px[0] > 245 && px[1] > 245 && px[2] > 245, "a see-through picture is put on white");

let threw = "";
try { await prepareImageOnServer(new Blob(["not a picture"]), 1600); } catch (e) { threw = (e as Error).message; }
ok(threw === "Couldn't prepare the image.", "bytes that are not a picture are refused");
