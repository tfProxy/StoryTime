// Server-sent events from a route handler (D5). `subscribe` is called once with a `send` function and answers how to stop;
// it may call `send` at once for what the page needs first. Every stream sends a comment line every 15 s, so a proxy
// doesn't close it, and stops listening when the client goes away.

export const PING_MS = 15_000;

export function sseResponse(
  request: Request,
  subscribe: (send: (event: unknown) => void) => () => void,
  options: { pingMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  let stop: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let ping: ReturnType<typeof setInterval> | null = null;
      const close = () => {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        unsubscribe?.();
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      stop = close;
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      request.signal.addEventListener("abort", close);
      if (request.signal.aborted) return close();
      // The first bytes open the stream on the client at once.
      write(": connected\n\n");
      ping = setInterval(() => write(": ping\n\n"), options.pingMs ?? PING_MS);
      try {
        unsubscribe = subscribe((event) => write(`data: ${JSON.stringify(event)}\n\n`));
      } catch (e) {
        close();
        throw e;
      }
      // closed while subscribing: `close` ran before there was anything to stop
      if (closed) (unsubscribe as (() => void) | null)?.();
    },
    cancel() {
      stop?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx and similar proxies hold back a streamed response unless told not to
      "X-Accel-Buffering": "no",
    },
  });
}
