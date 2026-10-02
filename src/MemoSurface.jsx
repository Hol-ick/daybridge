import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createAutosave } from "./memo/autosave.js";
import "./memo/memo.css";

const PREVIEW_KEY = "daybridge.memo.preview.v1";

export default function MemoSurface() {
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("saved");
  const [shortcut, setShortcut] = useState(isTauri() ? "registering" : "preview");
  /** @type {import("react").RefObject<HTMLTextAreaElement | null>} */
  const input = useRef(null);
  const writer = useMemo(() => createAutosave(async value => {
    if (isTauri()) await invoke("save_quick_memo", { text: value });
    else localStorage.setItem(PREVIEW_KEY, value);
  }, setStatus), []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    void (async () => {
      try {
        const contents = isTauri() ? await invoke("read_quick_memo") : localStorage.getItem(PREVIEW_KEY) || "";
        if (!cancelled) { setText(String(contents)); setReady(true); }
      } catch { if (!cancelled) setLoadError(true); }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    const focus = () => { input.current?.focus(); };
    focus();
    window.addEventListener("focus", focus);
    const unsubscribe = isTauri() ? listen("memo-focus", focus) : Promise.resolve(() => {});
    void unsubscribe.catch(() => {});
    return () => {
      window.removeEventListener("focus", focus);
      void unsubscribe.then(stop => stop()).catch(() => {});
    };
  }, [ready]);

  useEffect(() => {
    if (!isTauri()) return;
    const check = () => { void invoke("memo_shortcut_status").then(value => setShortcut(String(value))).catch(() => setShortcut("unavailable")); };
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  return <section className="quick-memo" aria-label="빠른 메모">
    <header><div><span className="memo-brand">DAYBRIDGE</span><h1>메모</h1></div><kbd>Ctrl + D</kbd></header>
    {shortcut === "unavailable" && <p className="memo-alert" role="alert">Ctrl+D를 등록하지 못했습니다. 다른 앱의 단축키 사용 여부를 확인해 주세요. 트레이의 ‘메모 열기’로도 열 수 있습니다.</p>}
    {loadError ? <div className="memo-load-error" role="alert"><p>저장된 메모를 읽지 못했습니다. 기존 내용은 변경하지 않았습니다.</p><button onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></div> :
      <textarea ref={input} aria-label="메모 내용" placeholder="떠오른 생각을 적어 두세요." value={text} disabled={!ready} spellCheck={false}
        onChange={event => { setText(event.target.value); writer.update(event.target.value); }}
        onKeyDown={event => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && isTauri()) {
            event.preventDefault(); void invoke("hide_quick_memo");
          }
          if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); writer.retry(); }
        }} />}
    <footer><span role="status" className={status === "error" ? "memo-save-error" : ""}>{!ready ? (loadError ? "불러오기 실패" : "불러오는 중…") : status === "saving" ? "저장 중…" : status === "error" ? "저장하지 못했습니다" : "자동 저장됨"}</span>
      {status === "error" ? <button onClick={() => writer.retry()}>다시 저장</button> : <span>{isTauri() ? "Esc 닫기 · 내용은 남아요" : "브라우저 미리보기"}</span>}
    </footer>
  </section>;
}
