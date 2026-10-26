// Called once when the server starts (not at build time). Starts the work queue's worker, which keeps working
// when no page is open.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/worker");
    startWorker();
  }
}
