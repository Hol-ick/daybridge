import { useEffect, useState } from "react";
import styles from "./ManualTaskForm.module.css";

/** @param {{onSubmit?: (input: {title: string}) => unknown | Promise<unknown>, compact?: boolean, iconOnly?: boolean, onOpenChange?: (open: boolean) => void, resetSignal?: number}} props */
export default function ManualTaskForm({ onSubmit, compact = false, iconOnly = false, onOpenChange, resetSignal = 0 }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setOpen(false);
    onOpenChange?.(false);
    setTitle("");
    setError("");
  };

  useEffect(() => {
    if (!resetSignal || !open) return;
    close();
  }, [resetSignal]);

  const submit = async (/** @type {import("react").SubmitEvent<HTMLFormElement>} */ event) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || submitting || !onSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await onSubmit({ title: clean });
      if (result !== false) close();
      else setError("추가하지 못했어요");
    } catch {
      setError("추가하지 못했어요");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={[styles.openButton, compact ? styles.compactOpen : "", iconOnly ? styles.iconOnly : ""].filter(Boolean).join(" ")}
        onClick={() => { setOpen(true); onOpenChange?.(true); }}
        data-tauri-drag-region="false"
        data-testid="manual-task-add-toggle"
        aria-label={iconOnly ? "작업 추가" : undefined}
        title={iconOnly ? "작업 추가" : undefined}
      >
        {iconOnly ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg> : <span aria-hidden="true">＋</span>}{iconOnly ? null : " 작업 추가"}
      </button>
    );
  }

  return (
    <form className={[styles.form, compact ? styles.compact : ""].filter(Boolean).join(" ")} onSubmit={submit} data-testid="manual-task-form" data-tauri-drag-region="false">
      <div className={styles.formTop}>
        <input
          className={styles.titleInput}
          value={title}
          onChange={(event) => { setTitle(event.target.value); setError(""); }}
          placeholder="할 일 입력"
          name="title"
          type="text"
          autoComplete="off"
          maxLength={180}
          autoFocus
          required
          data-testid="manual-task-title"
          aria-label="할 일 제목"
        />
        <button type="button" className={styles.cancel} onClick={close} disabled={submitting} data-tauri-drag-region="false" data-testid="manual-task-cancel">×</button>
        <button type="submit" className={styles.submit} disabled={!title.trim() || submitting} data-tauri-drag-region="false" data-testid="manual-task-submit">
          {submitting ? "…" : "추가"}
        </button>
      </div>
      {error ? <p className={styles.error} role="status" aria-live="polite">{error}</p> : null}
    </form>
  );
}
