import { createAutosave } from "./autosave.js";

/** @typedef {{id: string, revision: number, text: string, createdAtUnixMs: number, updatedAtUnixMs: number}} Draft */
/** @typedef {{id: string, revision: number}} SaveAck */
/** @typedef {SaveAck & {archived: boolean}} CloseAck */
/** @typedef {{draft: Draft, recovered: boolean}} MemoSession */

/**
 * @param {{begin: () => Promise<MemoSession>, save: (draft: Draft) => Promise<SaveAck>, finish: (draft: Draft) => Promise<CloseAck>, hide: () => Promise<void>}} api
 * @param {{report?: (status: "saving" | "saved" | "error") => void, clock?: {set: (callback: () => void, ms: number) => number, clear: (handle: number) => void}}} options
 */
export function createMemoSession(api, options = {}) {
  const clock = options.clock ?? {set: (/** @type {() => void} */ fn, /** @type {number} */ ms) => window.setTimeout(fn, ms), clear: (/** @type {number} */ handle) => window.clearTimeout(handle)};
  /** @type {MemoSession | null} */ let current = null;
  /** @type {Promise<MemoSession> | null} */ let opening = null;
  /** @type {Promise<void> | null} */ let closing = null;
  /** @type {ReturnType<typeof createAutosave<Draft, SaveAck>> | null} */ let writer = null;
  /** @type {CloseAck | null} */ let finished = null;
  let finalizing = false;
  /** @type {number | undefined} */ let debounce;
  /** @type {number | undefined} */ let maximum;
  function cancelTimers() { if (debounce !== undefined) clock.clear(debounce); if (maximum !== undefined) clock.clear(maximum); debounce = maximum = undefined; }
  function enqueue() { cancelTimers(); if (current && writer) writer.update({...current.draft}); }
  async function open() {
    if (closing) await closing;
    if (current) return current;
    if (opening) return opening;
    opening = (async () => {
      const session = await api.begin();
      if (!Number.isSafeInteger(session.draft.revision)) throw Error("corrupt_state");
      current = session; finished = null; finalizing = false;
      writer = createAutosave(async draft => {
        const ack = await api.save(draft);
        if (ack.id !== draft.id || ack.revision !== draft.revision) throw Error("stale_session");
        return ack;
      }, options.report ?? (() => {}));
      return session;
    })();
    try { return await opening; } finally { opening = null; }
  }
  /** @param {string} text */
  function edit(text) {
    if (!current || closing || finished || finalizing) return false;
    if (text === current.draft.text) return true;
    if (current.draft.revision >= Number.MAX_SAFE_INTEGER) throw Error("size_limit");
    current.draft = {...current.draft, text, revision: current.draft.revision + 1};
    options.report?.("saving");
    if (debounce !== undefined) clock.clear(debounce);
    debounce = clock.set(enqueue, 300);
    if (maximum === undefined) maximum = clock.set(enqueue, 1000);
    return true;
  }
  async function flush() { enqueue(); return writer?.flush(); }
  /** @param {string} _reason */
  async function close(_reason) {
    if (closing) return closing;
    if (opening) await opening;
    if (!current || !writer) return;
    closing = (async () => {
      if (!finished) {
        const draft = {.../** @type {MemoSession} */ (current).draft};
        if (!finalizing) {
          const ack = await flush();
          if (!ack || ack.id !== draft.id || ack.revision !== draft.revision) throw Error("stale_session");
          finalizing = true;
        }
        const result = await api.finish(draft);
        if (result.id !== draft.id || result.revision !== draft.revision) throw Error("stale_session");
        finished = result;
      }
      await api.hide();
      writer?.dispose(); writer = null; current = null; finished = null; finalizing = false;
    })();
    try { await closing; } catch (error) { options.report?.("error"); throw error; }
    finally { closing = null; }
  }
  return {open, edit, close, flush, get closing() { return closing !== null; }, get finalizing() { return finalizing; }, get draft() { return current?.draft ?? null; }, dispose() { cancelTimers(); writer?.dispose(); }};
}
