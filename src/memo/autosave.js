/** Serialize writes and coalesce pending edits so older saves cannot win.
 * @template T, A
 * @param {(text: T) => Promise<A>} save
 * @param {(status: "saving" | "saved" | "error") => void} report
 */
export function createAutosave(save, report) {
  /** @type {T | undefined} */
  let pending;
  /** @type {Promise<A | undefined> | null} */
  let running = null;
  /** @type {A | undefined} */
  let acknowledged;
  let disposed = false;
  async function drain() {
    if (running) return running;
    if (disposed || pending === undefined) return acknowledged;
    report("saving");
    const work = async () => { while (pending !== undefined) {
      const text = pending;
      pending = undefined;
      try { acknowledged = await save(text); }
      catch (error) {
        // Preserve the most recent edit, including an intentionally empty memo.
        if (pending === undefined) pending = text;
        report("error");
        throw error;
      }
    }
    report("saved");
    return acknowledged;
    };
    running = work();
    try { return await running; }
    finally { running = null; }
  }
  return {
    /** @param {T} text */
    update(text) { if (disposed) return; pending = text; void drain().catch(() => {}); },
    retry() { void drain().catch(() => {}); },
    async flush() { const ack = await drain(); if (pending !== undefined) return drain(); return ack; },
    dispose() { disposed = true; },
  };
}
