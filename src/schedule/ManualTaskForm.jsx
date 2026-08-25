import { useState } from "react";
import styles from "./ManualTaskForm.module.css";

const DURATIONS = [50, 100, 150];

function durationLabel(minutes) {
  return `${minutes}분`;
}

export default function ManualTaskForm({ onSubmit, compact = false, iconOnly = false }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    setOpen(false);
    setTitle("");
    setDurationMinutes(50);
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || submitting || !onSubmit) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await onSubmit({ title: clean, durationMinutes });
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
        onClick={() => setOpen(true)}
        data-tauri-drag-region="false"
        data-testid="manual-task-add-toggle"
        aria-label={iconOnly ? "작업 추가" : undefined}
      >
        <span aria-hidden="true">＋</span>{iconOnly ? null : " 작업 추가"}
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
          placeholder="예: 리눅스 학습…"
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
      </div>
      <div className={styles.formBottom}>
        <div className={styles.durationGroup} role="group" aria-label="작업 시간">
          {DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className={durationMinutes === minutes ? styles.durationSelected : styles.duration}
              onClick={() => { setDurationMinutes(minutes); setError(""); }}
              disabled={submitting}
              data-tauri-drag-region="false"
              data-testid={`manual-task-duration-${minutes}`}
              aria-pressed={durationMinutes === minutes}
            >
              {durationLabel(minutes)}
            </button>
          ))}
        </div>
        <button type="submit" className={styles.submit} disabled={!title.trim() || submitting} data-tauri-drag-region="false" data-testid="manual-task-submit">
          {submitting ? "저장…" : "배치"}
        </button>
      </div>
      {error ? <p className={styles.error} role="status" aria-live="polite">{error}</p> : null}
    </form>
  );
}
