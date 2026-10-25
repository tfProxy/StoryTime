// selfFetch: relative URLs go to this server, absolute ones are left alone.
import { selfBase, selfFetch } from "../../src/lib/worker/selfFetch.ts";

const ok = (c: boolean, m: string) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const seen: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  seen.push(String(input));
  return new Response("ok");
}) as typeof fetch;

const saved = { port: process.env.PORT, url: process.env.STORYTIME_SELF_URL };
try {
  delete process.env.STORYTIME_SELF_URL;
  delete process.env.PORT;
  ok(selfBase() === "http://127.0.0.1:3737", "the default base is port 3737");

  process.env.PORT = "3111";
  await selfFetch("/api/chapters/c1");
  ok(seen[0] === "http://127.0.0.1:3111/api/chapters/c1", "a relative URL goes to PORT on localhost");

  await selfFetch("http://comfy:8188/history");
  ok(seen[1] === "http://comfy:8188/history", "an absolute URL is left alone");

  const url = new URL("http://other/x");
  await selfFetch(url);
  ok(seen[2] === "http://other/x", "a URL object is left alone");

  process.env.STORYTIME_SELF_URL = "http://storytime:9000";
  await selfFetch("/api/health");
  ok(seen[3] === "http://storytime:9000/api/health", "STORYTIME_SELF_URL overrides PORT");
} finally {
  globalThis.fetch = realFetch;
  if (saved.port === undefined) delete process.env.PORT; else process.env.PORT = saved.port;
  if (saved.url === undefined) delete process.env.STORYTIME_SELF_URL; else process.env.STORYTIME_SELF_URL = saved.url;
}
