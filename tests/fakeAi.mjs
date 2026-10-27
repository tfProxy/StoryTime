// A fake AI server for tests: OpenAI-compatible chat completions (streaming, and plain when the request says
// `stream: false`) plus the Ollama endpoints StoryTime uses to free memory (`/api/ps`, `/api/generate`).
// Shared by the API tests and the Node smoke test; the older e2e files keep their own copies.
import http from "node:http";

/**
 * Starts the server and answers `{ url, requests, setReply, setDelay, close }`.
 *   reply   the text to answer with, or `(body, request) => string` (also async); the request body is the parsed JSON
 *   delay   milliseconds between the streamed pieces (the text is sent in three)
 *   loaded  the model names `/api/ps` lists as loaded
 * `requests` keeps every request as `{ method, url, body }`, so a test can check what was sent and in what order.
 * A prefix before `/v1/chat/completions`, `/api/ps` or `/api/generate` is accepted (`/ol/api/ps`).
 */
export async function startFakeAi({ port = 0, reply = "A reply from the fake AI.", delay = 20, loaded = [] } = {}) {
  const state = { reply, delay };
  const requests = [];
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", async () => {
      let body = {};
      try {
        body = data ? JSON.parse(data) : {};
      } catch {
        res.statusCode = 400;
        return res.end("bad json");
      }
      const path = (req.url ?? "").split("?")[0];
      const entry = { method: req.method, url: req.url, body };
      requests.push(entry);
      if (path.endsWith("/api/ps")) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ models: loaded.map((name) => ({ name, model: name })) }));
      }
      if (req.method === "GET" && path.endsWith("/models")) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ data: [{ id: "fake-model-a" }, { id: "fake-model-b" }] }));
      }
      if (path.endsWith("/api/generate")) {
        res.setHeader("content-type", "application/json");
        return res.end("{}");
      }
      if (!path.endsWith("/chat/completions")) {
        res.statusCode = 404;
        return res.end("not found");
      }
      const text = typeof state.reply === "function" ? await state.reply(body, entry) : state.reply;
      if (body.stream === false) {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
      }
      res.setHeader("content-type", "text/event-stream");
      const third = Math.ceil(text.length / 3);
      const pieces = [text.slice(0, third), text.slice(third, 2 * third), text.slice(2 * third)].filter((p) => p !== "");
      let i = 0;
      let closed = false;
      res.on("close", () => { closed = true; });
      const next = () => {
        if (closed) return;
        if (i < pieces.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i++] } }] })}\n\n`);
          setTimeout(next, state.delay);
        } else {
          res.write("data: [DONE]\n\n");
          res.end();
        }
      };
      next();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  const actual = server.address().port;
  return {
    port: actual,
    url: `http://localhost:${actual}`,
    requests,
    setReply: (r) => { state.reply = r; },
    setDelay: (ms) => { state.delay = ms; },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
