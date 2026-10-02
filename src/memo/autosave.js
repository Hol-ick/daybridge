/** Serialize writes and coalesce pending edits so older saves cannot win.
 * @param {(text: string) => Promise<void>} save
 * @param {(status: "saving" | "saved" | "error") => void} report
 */
export function createAutosave(save, report) {
  /** @type {string | undefined} */
  let pending;
  let running = false;
  async function drain() {
    if (running || pending === undefined) return;
    running = true;
    report("saving");
    while (pending !== undefined) {
      const text = pending;
      pending = undefined;
      try { await save(text); }
      catch {
        // Preserve the most recent edit, including an intentionally empty memo.
        if (pending === undefined) pending = text;
        running = false;
        report("error");
        return;
      }
    }
    running = false;
    report("saved");
  }
  return {
    /** @param {string} text */
    update(text) { pending = text; void drain(); },
    retry() { void drain(); },
  };
}
