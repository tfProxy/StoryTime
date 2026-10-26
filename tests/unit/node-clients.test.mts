// The ComfyUI and AI clients run from Node, as the server's work queue will use them: a job rebuilt with fromSpec is
// queued on a fake ComfyUI and waited for (over the WebSocket, and by polling), and a chat is streamed from a fake AI.
import { startFakeComfy, makePng } from "../e2e/fakeComfy.mjs";
import { startFakeAi } from "../fakeAi.mjs";
import { waitForPictures, type Progress } from "../../src/lib/comfy/client.ts";
import { fromSpec, maskUploadKey, toSpec } from "../../src/lib/comfy/jobSpec.ts";
import { queueJob, type JobInput } from "../../src/lib/comfy/makeJob.ts";
import { DEFAULT_DRAW_PRESETS } from "../../src/lib/comfy/presets.ts";
import { chapterTarget } from "../../src/lib/pictureTarget.ts";
import { DEFAULT_SETTINGS } from "../../src/lib/settingsSchema.ts";
import { completeChat, streamChat } from "../../src/lib/ai/client.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const comfy = await startFakeComfy({ port: 3556, steps: 2, stepDelay: 20, startDelay: 50 });
const ai = await startFakeAi({ reply: "Once upon a time.", delay: 5, loaded: [] });

try {
  ok(typeof createImageBitmap === "undefined" && typeof document === "undefined", "this runs without a browser's canvas or DOM");

  const startBytes = new Uint8Array(makePng(2));
  const maskBytes = new Uint8Array(makePng(5));
  const sources: Record<string, Uint8Array> = { "comfy:start.png": startBytes, "upload:mask-1": maskBytes };
  const resolved: string[] = [];
  const resolve = async (source: string) => {
    resolved.push(source);
    const bytes = sources[source];
    if (!bytes) throw new Error(`unknown source ${source}`);
    return new Blob([bytes], { type: "image/png" });
  };

  const draw = { ...DEFAULT_DRAW_PRESETS[0], checkpoint: "fake_sdxl_a.safetensors" };
  const input: JobInput = {
    prompt: "a red fox",
    negative: "blurry",
    moment: "header",
    comfy: { ...DEFAULT_SETTINGS.comfy, url: comfy.url },
    draw,
    drawLoras: [],
    family: null,
    redraw: 0.55,
    start: { key: "comfy:start.png", source: "comfy:start.png", thumb: "", blob: async () => new Blob() },
    mask: { strokes: [], softness: 0, inverted: false, id: "m1", width: 96, height: 60 },
    edit: null,
    seed: 123,
  };
  // Through JSON, as the browser will send it, and with the mask uploaded to the server as the browser would.
  const rebuild = () => fromSpec(JSON.parse(JSON.stringify(toSpec(input, { [maskUploadKey("m1")]: "upload:mask-1" }))), resolve);
  let job = rebuild();

  for (const ws of [true, false]) {
    job = rebuild(); // a mask's upload is kept per mask object, so each run needs its own
    comfy.setMode({ ws });
    const label = ws ? "WebSocket" : "polling";
    const calls = comfy.calls.length;
    const progress: Progress[] = [];
    let promptId = "";
    let size: [number, number] | null = null;
    const controller = new AbortController();
    const made = await queueJob(job, 2, { ...chapterTarget("s1", "c1"), instance: "node-test" }, {
      signal: controller.signal,
      uploads: { current: null },
      onProgress: (p) => progress.push(p),
      onSize: (w, h) => { size = [w, h]; },
      onPromptId: (id) => { promptId = id; },
      beforeQueue: async () => {},
    });
    ok(made.promptId !== "" && made.promptId === promptId, `${label}: the job is queued on ComfyUI and its id is reported`);
    const fresh = comfy.calls.slice(calls);
    const uploads = fresh.filter((c: { path: string }) => c.path === "/upload/image");
    ok(uploads.length === 2, `${label}: the start and the mask are uploaded (${uploads.length})`);
    // (The fake keeps the form fields that follow the file too, so the stored bytes are compared by their start.)
    const gotMask: Buffer | undefined = made.record.mask ? comfy.uploaded(made.record.mask) : undefined;
    ok(!!gotMask && Buffer.compare(gotMask.subarray(0, maskBytes.length), Buffer.from(maskBytes)) === 0, `${label}: ComfyUI got the mask's own bytes`);
    ok(made.record.source === "comfy:start.png" && made.record.width === 96 && made.record.height === 60, `${label}: the size of the start was read without a canvas (${made.record.width}x${made.record.height})`);
    void size;

    const images = await waitForPictures(comfy.url, made.promptId, made.clientId, (p) => progress.push(p), controller.signal);
    ok(images.length === 2 && images.every((i) => i.type === "output"), `${label}: waitForPictures returns the 2 pictures`);
    ok(ws ? progress.some((p) => p.stage === "running") : !progress.some((p) => p.stage === "running"), `${label}: progress ${ws ? "arrives over the socket" : "is not reported, the history is polled"}`);
  }
  ok(resolved.includes("comfy:start.png") && resolved.includes("upload:mask-1"), "the pictures were fetched through the resolver by source");

  // A stopped wait ends with an AbortError, as the queue expects.
  comfy.setMode({ ws: true, stepDelay: 200 });
  const stop = new AbortController();
  const made = await queueJob({ ...job, start: null, mask: null }, 1, { ...chapterTarget("s1", "c1"), instance: null }, {
    signal: stop.signal, uploads: { current: null }, onProgress: () => {}, onSize: () => {}, onPromptId: () => {},
  });
  const waiting = waitForPictures(comfy.url, made.promptId, made.clientId, () => {}, stop.signal);
  setTimeout(() => stop.abort(), 50);
  const err = await waiting.then(() => null, (e) => e);
  ok(err instanceof DOMException && err.name === "AbortError", "aborting a wait rejects with an AbortError");

  // The AI client.
  const settings = {
    ...DEFAULT_SETTINGS,
    connections: [{ id: "c1", name: "Fake", kind: "custom", baseUrl: `${ai.url}/v1`, apiKey: "k" }],
    defaults: { main: { connectionId: "c1", model: "m" }, cheap: { connectionId: "c1", model: "m" } },
  } as never;
  let text = "";
  for await (const piece of streamChat(settings, { system: "sys", messages: [{ role: "user", content: "Tell me a story" }] })) text += piece;
  ok(text === "Once upon a time.", `streamChat streams the reply in Node (${JSON.stringify(text)})`);
  ok((await completeChat(settings, { messages: [{ role: "user", content: "again" }] })) === "Once upon a time.", "completeChat collects the reply");
  ok(ai.requests.at(-1)?.url === "/v1/chat/completions" && ai.requests.at(-1)?.body.stream === true, "the fake AI saw a streaming request");
} finally {
  await comfy.close();
  await ai.close();
}
