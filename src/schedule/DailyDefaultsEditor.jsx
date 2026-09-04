import styles from "./DailyDefaultsEditor.module.css";
import { useState } from "react";

function updateItem(items, id, patch) {
  return items.map((item) => item.id === id ? { ...item, ...patch } : item);
}

export default function DailyDefaultsEditor({ value = [], onChange, loading = false }) {
  const routines = Array.isArray(value) ? value : [];
  const [newTitle, setNewTitle] = useState("");

  const addRoutine = () => {
    const clean = newTitle.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!clean || routines.some((item) => item.title.toLocaleLowerCase("ko-KR") === clean.toLocaleLowerCase("ko-KR"))) return;
    onChange?.([...routines, { id: `daily-${Date.now()}`, title: clean, estimateMinutes: 25, days: [0, 1, 2, 3, 4, 5, 6], enabled: true }]);
    setNewTitle("");
  };

  return (
    <section className={styles.editor} aria-labelledby="daily-defaults-title">
      <header className={styles.heading}>
        <div>
          <strong id="daily-defaults-title">매일 반복할 일</strong>
          <small>켜 둔 항목만 오늘 할 일에 추가됩니다.</small>
        </div>
      </header>
      {loading ? <p className={styles.empty}>기본 일정을 불러오는 중…</p> : routines.length ? (
        <div className={styles.list}>
          {routines.map((item) => (
            <div className={[styles.item, item.enabled === false ? styles.disabled : ""].filter(Boolean).join(" ")} key={item.id}>
              <button
                type="button"
                className={styles.toggle}
                aria-pressed={item.enabled !== false}
                onClick={() => onChange?.(updateItem(routines, item.id, { enabled: item.enabled === false }))}
              >
                {item.enabled === false ? "중지" : "활성"}
              </button>
              <input
                value={item.title}
                aria-label={`${item.title} 기본 일정 제목`}
                onChange={(event) => onChange?.(updateItem(routines, item.id, { title: event.target.value.slice(0, 120) }))}
              />
              <button type="button" className={styles.remove} aria-label={`${item.title} 삭제`} onClick={() => onChange?.(routines.filter((entry) => entry.id !== item.id))}>×</button>
            </div>
          ))}
        </div>
      ) : <p className={styles.empty}>등록된 기본 일정이 없습니다.</p>}
      <div className={styles.addRow}>
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value.slice(0, 120))}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRoutine(); } }}
          placeholder="예: 오전 메일 확인"
          aria-label="새 매일 기본 일정"
          disabled={loading}
        />
        <button type="button" className={styles.add} onClick={addRoutine} disabled={loading || !newTitle.trim()}>＋ 추가</button>
      </div>
    </section>
  );
}
