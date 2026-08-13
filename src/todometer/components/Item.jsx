import { useState } from "react";
import { useAppActions, useAppState } from "../../AppContext.jsx";
import styles from "./Item.module.css";

function Item({ quest }) {
  const { toggleQuest, setQuestStatus, deferQuest, reportQuest } = useAppActions();
  const { expandedQuestId, board } = useAppState();
  const [celebratingStep, setCelebratingStep] = useState("");
  const open = expandedQuestId === quest.id;
  const completed = quest.state === "completed";
  const waiting = ["blocked", "deferred"].includes(quest.state);
  const blocked = quest.state === "blocked";
  const questLocked = (quest.dependsOn || quest.depends_on || []).some((dependencyId) => board.quests.find((item) => item.id === dependencyId)?.state !== "completed");
  const done = quest.progress?.completed ?? quest.steps.filter((step) => step.completed).length;
  const total = quest.progress?.total ?? quest.steps.length;
  const progressLabel = blocked ? "응답 대기" : `${done}/${total} 완료`;

  function isLocked(step) {
    if (quest.execution !== "sequential") return false;
    const dependencyIds = step.dependsOn || step.depends_on || [];
    return dependencyIds.some((dependencyId) => !quest.steps.find((item) => item.id === dependencyId)?.completed);
  }

  function toggleStep(step) {
    if (isLocked(step)) return;
    const steps = quest.steps.map((current) => current.id === step.id ? { ...current, completed: !current.completed } : { ...current });
    const nextStatus = steps.length > 0 && steps.every((current) => current.completed) ? "completed" : "in_progress";
    setCelebratingStep(step.id);
    window.setTimeout(() => setCelebratingStep(""), 520);
    void reportQuest({ questId: quest.id, status: nextStatus, steps, note: `${steps.filter((current) => current.completed).length}/${steps.length}개 작업 완료 처리`, nextAction: steps.find((current) => !current.completed)?.label ?? "" });
  }

  return (
    <div className={`${styles.item} ${completed ? styles.completedItem : ""} ${waiting ? styles.pausedItem : ""} ${questLocked ? styles.lockedItem : ""}`} data-testid="quest-item" data-state={quest.state} data-locked={questLocked ? "true" : "false"}>
      <button type="button" className={styles.itemname} onClick={() => toggleQuest(quest.id)} aria-expanded={open} data-testid="quest-toggle">
        <span className={styles.copy}><strong>{quest.title}</strong><small>{progressLabel}</small></span>
      </button>
      <div className={styles.buttons}>
        {!completed && !waiting && <button type="button" disabled={questLocked} className={styles.pause} onClick={() => deferQuest(quest)} aria-label="내일로 미루기">↥</button>}
        {waiting && !blocked && <button type="button" disabled={questLocked} className={styles.resume} onClick={() => setQuestStatus(quest, "in_progress")} aria-label="퀘스트 다시 시작">▶</button>}
        {!completed && !blocked && <button type="button" disabled={questLocked} className={styles.complete} onClick={() => setQuestStatus(quest, "completed")} aria-label="퀘스트 완료">✓</button>}
      </div>
      <div className={`${styles.questDetails} ${open ? styles.questDetailsOpen : ""}`} aria-hidden={!open} data-testid="quest-details" data-open={open ? "true" : "false"}>
        <div className={styles.subquests}>
          {blocked ? <div className={styles.blockedNote}>{quest.firstStep || "원본 응답이 확보되면 다시 진행할 수 있어요."}</div> : quest.steps.map((step) => {
            const locked = isLocked(step);
            return <button key={step.id} type="button" disabled={locked} className={`${styles.subquest} ${step.completed ? styles.subquestCompleted : ""} ${locked ? styles.subquestLocked : ""} ${celebratingStep === step.id ? styles.subquestCelebrating : ""}`} onClick={() => toggleStep(step)} aria-pressed={step.completed} aria-disabled={locked} data-testid="subquest"><span className={styles.subquestCheck}>{locked ? "🔒" : step.completed ? "✓" : ""}</span><span>{step.label}</span></button>;
          })}
        </div>
      </div>
    </div>
  );
}

export default Item;
