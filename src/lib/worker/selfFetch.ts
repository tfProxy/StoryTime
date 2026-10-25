// A `fetch` for server code that calls StoryTime's own routes. The runner helpers in `src/lib/aiRuns/` use relative
// URLs (`/api/chapters/...`), which only work in a browser; this turns them into requests to this server.
import type { Fetch } from "../aiRuns/api";

/** Where this server listens, for its own calls. `next start -p` sets PORT, and the Docker image sets it to 3737. */
export function selfBase(): string {
  return process.env.STORYTIME_SELF_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3737}`;
}

export const selfFetch: Fetch = (input, init) =>
  fetch(typeof input === "string" && input.startsWith("/") ? `${selfBase()}${input}` : input, init);
