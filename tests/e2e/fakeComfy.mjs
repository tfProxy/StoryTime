// A fake ComfyUI server for the browser tests. It speaks just enough of ComfyUI's HTTP and WebSocket
// API for StoryTime: /system_stats, /models/checkpoints, /upload/image (names only; /prompt refuses a
// LoadImage naming a picture that wasn't uploaded), /prompt, /history/<id>, /view, /queue,
// /interrupt and a WebSocket at /ws that reports progress. Node has no WebSocket server built in, so
// the handshake and the (unmasked, short) text frames are done by hand below.
//
//   const comfy = await startFakeComfy({ port: 3555, checkpoints: ["a.safetensors"], steps: 4 });
//   comfy.url        "http://localhost:3555"
//   comfy.calls      every request received: { method, path, query, body } (body parsed when it is JSON)
//   comfy.setMode({ steps, stepDelay, startDelay, ws, fail, checkpoints })
//   await comfy.close()
//
// Options (also changeable later with setMode):
//   ws          true: accept WebSocket connections and send progress; false: refuse the upgrade, so
//               the page has to find the pictures by polling /history
//   steps       progress messages per job, with `stepDelay` ms between them (default 4 and 120)
//   fail        null | "refuse" (POST /prompt answers 400 with node_errors, like a workflow ComfyUI
//               rejects) | "error" (the job starts, then fails with an execution error) | "upload"
//               (POST /upload/image answers 400)
import crypto from "node:crypto";
import http from "node:http";
import zlib from "node:zlib";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** A valid PNG, 96 x 60 pixels, in a colour that depends on `index`, so the pictures can be told apart. */
export function makePng(index) {
  const w = 96, h = 60;
  const colors = [[220, 70, 60], [60, 140, 220], [70, 180, 90], [230, 190, 50], [160, 90, 200], [60, 190, 190], [240, 130, 60], [120, 120, 120]];
  const [r, g, b] = colors[index % colors.length];
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const shade = 1 - (x / w) * 0.4; // a little gradient, so it is not a flat fill
      raw[row + 1 + x * 3] = Math.round(r * shade);
      raw[row + 2 + x * 3] = Math.round(g * shade);
      raw[row + 3 + x * 3] = Math.round(b * shade);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** One unmasked WebSocket text frame. */
function textFrame(text) {
  const payload = Buffer.from(text, "utf8");
  let head;
  if (payload.length < 126) head = Buffer.from([0x81, payload.length]);
  else {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([head, payload]);
}

export async function startFakeComfy({ port = 3555, checkpoints = ["fake_sdxl_a.safetensors", "fake_sdxl_b.safetensors"], ws = true, steps = 4, stepDelay = 120, startDelay = 300, fail = null, version = "0.3.99" } = {}) {
  const mode = { checkpoints, ws, steps, stepDelay, startDelay, fail, version };
  const calls = [];
  const jobs = new Map(); // prompt_id -> job
  const uploads = new Set(); // names of pictures uploaded with POST /upload/image
  const history = {};
  const sockets = new Map(); // client id -> socket
  const conns = new Set();
  let jobNo = 0;
  let chain = Promise.resolve();
  let closed = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref());
  const send = (clientId, msg) => sockets.get(clientId)?.write(textFrame(JSON.stringify(msg)));
  const pending = () => [...jobs.values()].filter((j) => j.state === "queued" || j.state === "running").length;

  async function run(job) {
    if (job.cancelled || closed) return;
    job.state = "running";
    await sleep(mode.startDelay);
    const total = mode.steps;
    send(job.clientId, { type: "execution_start", data: { prompt_id: job.id } });
    for (let i = 1; i <= total; i++) {
      if (job.cancelled || closed) return;
      if (mode.fail === "error" && i === 2) {
        job.state = "error";
        const exception_message = "Out of memory (fake ComfyUI)\n";
        history[job.id] = { prompt: [], outputs: {}, status: { status_str: "error", completed: false, messages: [["execution_error", { prompt_id: job.id, exception_message }]] } };
        send(job.clientId, { type: "execution_error", data: { prompt_id: job.id, exception_message } });
        return;
      }
      send(job.clientId, { type: "progress", data: { value: i, max: total, prompt_id: job.id, node: "3" } });
      await sleep(mode.stepDelay);
    }
    if (job.cancelled || closed) return;
    job.state = "done";
    const images = Array.from({ length: job.count }, (_, i) => ({ filename: `StoryTime_${job.no}_${i}.png`, subfolder: "", type: "output" }));
    history[job.id] = { prompt: [], outputs: { "9": { images } }, status: { status_str: "success", completed: true, messages: [] } };
    send(job.clientId, { type: "executing", data: { node: null, prompt_id: job.id } });
  }

  function cancel(id) {
    const targets = id ? [jobs.get(id)] : [...jobs.values()];
    for (const job of targets) {
      if (!job || (job.state !== "queued" && job.state !== "running")) continue;
      job.cancelled = true;
      job.state = "cancelled";
      send(job.clientId, { type: "execution_interrupted", data: { prompt_id: job.id } });
    }
  }

  function queue(body) {
    const nodes = Object.entries(body.prompt ?? {});
    const nodeErrors = {};
    if (mode.fail === "refuse") {
      nodeErrors["3"] = { class_type: "KSampler", dependent_outputs: ["9"], errors: [{ type: "required_input_missing", message: "Required input is missing", details: "positive" }] };
    }
    for (const [id, node] of nodes) {
      const name = node?.inputs?.ckpt_name;
      if (node?.class_type === "CheckpointLoaderSimple" && !mode.checkpoints.includes(name)) {
        nodeErrors[id] = {
          class_type: "CheckpointLoaderSimple",
          dependent_outputs: ["9"],
          errors: [{ type: "value_not_in_list", message: "Value not in list", details: `ckpt_name: '${name}' not in [${mode.checkpoints.map((c) => `'${c}'`).join(", ")}]` }],
        };
      }
    }
    if (Object.keys(nodeErrors).length > 0) {
      return { status: 400, body: { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "", extra_info: {} }, node_errors: nodeErrors } };
    }
    for (const [id, node] of nodes) {
      const image = node?.inputs?.image;
      if (node?.class_type === "LoadImage" && !uploads.has(image)) {
        nodeErrors[id] = {
          class_type: "LoadImage",
          dependent_outputs: ["9"],
          errors: [{ type: "value_not_in_list", message: "Value not in list", details: `image: '${image}' not in [${[...uploads].map((u) => `'${u}'`).join(", ")}]` }],
        };
      }
    }
    if (Object.keys(nodeErrors).length > 0) {
      return { status: 400, body: { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "", extra_info: {} }, node_errors: nodeErrors } };
    }
    const batch = nodes.map(([, n]) => n?.inputs?.batch_size ?? n?.inputs?.amount).find((v) => typeof v === "number") ?? 1;
    const job = { id: crypto.randomUUID(), no: ++jobNo, clientId: String(body.client_id ?? ""), count: batch, state: "queued", cancelled: false };
    jobs.set(job.id, job);
    chain = chain.then(() => run(job)).catch(() => {});
    return { status: 200, body: { prompt_id: job.id, number: job.no, node_errors: {} } };
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let body = null;
      if (data) {
        try { body = JSON.parse(data); } catch { body = data; }
      }
      calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      const json = (status, value) => {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(value));
      };
      const p = url.pathname;
      if (p === "/system_stats") return json(200, { system: { comfyui_version: mode.version, os: "nt" }, devices: [] });
      if (p === "/models/checkpoints") return json(200, mode.checkpoints);
      if (p === "/upload/image" && req.method === "POST") {
        // multipart/form-data: only the file name is read; a name taken twice gets "(1)" like ComfyUI does.
        const given = /name="image"; filename="([^"]+)"/.exec(typeof body === "string" ? body : "")?.[1];
        if (!given || mode.fail === "upload") return json(400, { error: "no image" });
        let name = given;
        while (uploads.has(name)) name = name.replace(/(\(\d+\))?(\.\w+)$/, (_, n, ext) => `(${n ? Number(n.slice(1, -1)) + 1 : 1})${ext}`);
        uploads.add(name);
        return json(200, { name, subfolder: "", type: "input" });
      }
      if (p === "/prompt" && req.method === "POST") {
        const r = queue(body && typeof body === "object" ? body : {});
        return json(r.status, r.body);
      }
      if (p.startsWith("/history/")) {
        const id = decodeURIComponent(p.slice("/history/".length));
        return json(200, history[id] ? { [id]: history[id] } : {});
      }
      if (p === "/view") {
        const index = Number(/_(\d+)\.png$/.exec(url.searchParams.get("filename") ?? "")?.[1] ?? 0);
        res.statusCode = 200;
        res.setHeader("content-type", "image/png");
        return res.end(makePng(index));
      }
      if (p === "/queue" && req.method === "POST") {
        for (const id of body?.delete ?? []) cancel(id);
        return json(200, {});
      }
      if (p === "/queue") return json(200, { queue_running: [], queue_pending: [] });
      if (p === "/interrupt") {
        cancel(body?.prompt_id);
        return json(200, {});
      }
      return json(404, { error: "not found" });
    });
  });
  server.on("connection", (c) => {
    conns.add(c);
    c.on("close", () => conns.delete(c));
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://x");
    calls.push({ method: "UPGRADE", path: url.pathname, query: Object.fromEntries(url.searchParams), body: null });
    const key = req.headers["sec-websocket-key"];
    if (!mode.ws || url.pathname !== "/ws" || typeof key !== "string") {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const clientId = url.searchParams.get("clientId") ?? "";
    sockets.set(clientId, socket);
    conns.add(socket);
    socket.on("close", () => {
      conns.delete(socket);
      if (sockets.get(clientId) === socket) sockets.delete(clientId);
    });
    socket.on("error", () => {});
    socket.on("data", (buf) => {
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x8) socket.end(Buffer.from([0x88, 0x00]));
      else if (opcode === 0x9) socket.write(Buffer.from([0x8a, 0x00]));
    });
    send(clientId, { type: "status", data: { status: { exec_info: { queue_remaining: pending() } }, sid: clientId } });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });

  return {
    url: `http://localhost:${port}`,
    calls,
    /** Changes how the fake behaves from now on. */
    setMode: (patch) => Object.assign(mode, patch),
    async close() {
      closed = true;
      for (const c of conns) c.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
