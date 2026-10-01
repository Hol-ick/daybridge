/**
 * WebViews can execute while native setup is still starting the bundled bridge.
 * Keep first HTTP requests behind that setup, with a separate startup deadline.
 * A failed bootstrap still mounts the UI so its existing error/retry flow works.
 * @param {{desktop: boolean, ensureBridge: () => Promise<unknown> | unknown,
 * mount: () => void, report: (event: string, details: Record<string, unknown>) => void,
 * timeoutMs?: number}} options
 */
export async function mountAfterBridgeReady({ desktop, ensureBridge, mount, report, timeoutMs = 10000 }) {
  if (desktop) {
    const startedAt = Date.now();
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(ensureBridge),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Native bridge startup timed out")), timeoutMs);
        }),
      ]);
      report("webview_bridge_startup_ready", { elapsedMs: Date.now() - startedAt });
    } catch (error) {
      report("webview_bridge_startup_failed", {
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  mount();
}
