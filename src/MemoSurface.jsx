import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createMemoSession } from "./memo/session.js";
import { createPreviewMemoApi } from "./memo/preview.js";
import "./memo/memo.css";

export default function MemoSurface() {
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [closeError, setCloseError] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [logHealthy, setLogHealthy] = useState(true);
  const [status, setStatus] = useState("saved");
  /** @type {import('react').RefObject<HTMLTextAreaElement | null>} */ const input = useRef(null);
  const composing = useRef(false);
  /** @type {import('react').RefObject<(() => void)[]>} */ const compositionWaiters = useRef([]);
  const session = useMemo(() => {
    /** @template T @param {T & {logHealthy?: boolean}} result @returns {T} */
    const health = result => { setLogHealthy(result.logHealthy !== false); return result; };
    const api = isTauri() ? {
      begin: async () => health(await invoke("begin_memo_session")),
      /** @param {import('./memo/session.js').Draft} draft */
      save: async draft => health(await invoke("save_memo_draft", {id:draft.id,revision:draft.revision,text:draft.text})),
      /** @param {import('./memo/session.js').Draft} draft */
      finish: async draft => health(await invoke("finalize_memo_session", {id:draft.id,revision:draft.revision,text:draft.text})),
      hide: async () => { await invoke("hide_quick_memo"); await invoke("complete_memo_exit"); },
    } : createPreviewMemoApi();
    return createMemoSession(api, {report:setStatus});
  }, []);

  useEffect(() => { if (ready && !closed) input.current?.focus(); }, [ready, closed]);

  async function open() {
    try {
      const result = await session.open();
      setText(result.draft.text); setRecovered(result.recovered && !!result.draft.text); setReady(true); setClosed(false); setError(""); setCloseError(false);
      requestAnimationFrame(() => input.current?.focus());
    } catch { setError("저장된 메모를 읽지 못했습니다. 기존 내용은 변경하지 않았습니다."); }
  }
  /** @param {string} reason */
  async function close(reason) {
    if (!session.draft) { await open(); if (!session.draft) return; }
    if (composing.current) await new Promise(resolve => { compositionWaiters.current.push(() => resolve(undefined)); input.current?.blur(); });
    // Read the DOM after compositionend/input settle so the last IME character is included.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (input.current && !session.finalizing) session.edit(input.current.value);
    setBusy(true);
    try { await session.close(reason); setText(""); setReady(false); setClosed(true); setError(""); setCloseError(false); }
    catch { setError("보관하지 못했습니다. 내용을 유지하고 있습니다."); setCloseError(true); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (!ready) { await open(); return; }
    if (closeError) { await close("retry"); return; }
    try { await session.flush(); setError(""); } catch { setError("저장하지 못했습니다. 다시 시도해 주세요."); }
  }

  useEffect(() => {
    let alive = true;
    const focus = () => { if (alive) void open(); };
    window.addEventListener("focus", focus);
    /** @type {Promise<() => void>[]} */ const listeners = [];
    if (isTauri()) {
      listeners.push(listen("memo-focus", focus));
      listeners.push(listen("memo-close-request", () => { if (alive) void close("native"); }));
      void Promise.all(listeners).then(async () => { if (alive && await getCurrentWindow().isVisible()) await open(); }).catch(() => { if (alive) setError("메모창을 준비하지 못했습니다. 다시 시도해 주세요."); });
    } else { void open(); }
    return () => { alive = false; window.removeEventListener("focus", focus); for (const listener of listeners) void listener.then(stop => stop()).catch(() => {}); };
    // The stable session keeps its draft across native focus and close events.
  }, [session]);

  return <section className="quick-memo" aria-label="빠른 메모">
    <div className="memo-toolbar">
      <div className="memo-drag" aria-hidden="true" onPointerDown={event => { if (isTauri() && event.button === 0) void getCurrentWindow().startDragging().catch(() => {}); }} />
      <button className="memo-close" aria-label="메모 닫기" title="닫기 (Esc)" disabled={busy || !ready} onClick={() => { void close("button"); }}>×</button>
    </div>
    {closed && !isTauri() ? <button className="memo-preview-open" onClick={() => { void open(); }}>메모 열기</button> :
      <textarea ref={input} aria-label="메모 내용" value={text} disabled={!ready} readOnly={busy || session.finalizing} spellCheck={false}
        onChange={event => { if (session.edit(event.target.value)) { setText(event.target.value); setRecovered(false); } }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={event => { composing.current = false; if (session.edit(event.currentTarget.value)) setText(event.currentTarget.value); const waiters = compositionWaiters.current.splice(0); for (const release of waiters) release(); }}
        onKeyDown={event => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void close("escape"); }
          if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); void retry(); }
        }} />}
    {(error || status === "error") && <div className="memo-alert" role="alert"><span>{error || "저장하지 못했습니다. 내용을 유지하고 있습니다."}</span><button onClick={() => { void retry(); }}>{closeError ? "다시 닫기" : !ready ? "다시 불러오기" : "다시 저장"}</button></div>}
    {recovered && !error && <p className="memo-notice">작성 중이던 메모를 복구했습니다.</p>}
    {!logHealthy && <p className="memo-notice" role="alert">메모는 저장됐지만 동작 기록을 남기지 못했습니다.</p>}
    <span className="memo-sr-only" role="status">{status === "saving" ? "저장 중…" : status === "error" ? "저장하지 못했습니다" : "자동 저장됨"}</span>
  </section>;
}
