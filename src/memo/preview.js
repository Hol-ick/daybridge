/** Browser-only storage; it never reads native notes or the legacy preview key. */
export const PREVIEW_KEY = "daybridge.memo.preview.sessions.v2";
/** @typedef {import('./session.js').Draft} Draft */
/** @typedef {{schemaVersion: 2, active: Draft | null, archives: Draft[], lastClosed: import('./session.js').CloseAck | null}} State */
export function createPreviewMemoApi() {
  /** @returns {State} */
  function read() {
    const raw = localStorage.getItem(PREVIEW_KEY);
    if (!raw) return {schemaVersion:2,active:null,archives:[],lastClosed:null};
    const state = JSON.parse(raw);
    if (state.schemaVersion !== 2 || !Array.isArray(state.archives) || (state.active && (typeof state.active.text !== "string" || !Number.isSafeInteger(state.active.revision)))) throw Error("corrupt_state");
    return state;
  }
  /** @param {State} state */
  function write(state) { localStorage.setItem(PREVIEW_KEY, JSON.stringify(state)); }
  /** @param {Draft} draft */
  function validate(draft) {
    if (new TextEncoder().encode(draft.text).length > 1024 * 1024) throw Error("size_limit");
    const state = read();
    if (state.active?.id !== draft.id || state.active.revision > draft.revision) throw Error("stale_session");
    return state;
  }
  return {
    async begin() {
      const state = read(); const recovered = !!state.active;
      state.active ??= {id:crypto.randomUUID(),revision:0,text:"",createdAtUnixMs:Date.now(),updatedAtUnixMs:Date.now()};
      write(state); return {draft:{...state.active},recovered};
    },
    /** @param {Draft} draft */
    async save(draft) { const state = validate(draft); state.active = {...draft,updatedAtUnixMs:Date.now()}; write(state); return {id:draft.id,revision:draft.revision}; },
    /** @param {Draft} draft */
    async finish(draft) {
      const previous = read().lastClosed;
      if (previous?.id === draft.id && previous.revision === draft.revision) return previous;
      const state = validate(draft); const archived = !!draft.text.trim();
      if (archived) state.archives.push({...draft});
      state.active = null; state.lastClosed = {id:draft.id,revision:draft.revision,archived}; write(state);
      return state.lastClosed;
    },
    async hide() {},
  };
}
