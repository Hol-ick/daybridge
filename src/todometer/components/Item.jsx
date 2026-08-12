import { useState } from "react";
import { useAppActions, useAppState } from "../../AppContext.jsx";
import styles from "./Item.module.css";

function Item({ quest, index }) {
  const { toggleQuest, setQuestStatus, deferQuest, reportQuest } = useAppActions();
  const { expandedQuestId, board } = useAppState();
  const [celebratingStep, setCelebratingStep] = useState("");
  const open = expandedQuestId === quest.id;
  const completed = quest.state === "completed";
  const waiting = ["blocked", "deferred"].includes(quest.state);
  const questLocked = (quest.dependsOn || quest.depends_on || []).some((dependencyId) => board.quests.find((item) => item.id === dependencyId)?.state !== "completed");
  const done = quest.progress?.completed ?? quest.steps.filter((step) => step.completed).length;
  const total = quest.progress?.total ?? quest.steps.length;

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
    void reportQuest({ questId: quest.id, status: nextStatus, steps, note: `${steps.filter((current) => current.completed).length}/${steps.length} quest units checked`, nextAction: steps.find((current) => !current.completed)?.label ?? "" });
  }

  return (
    <div className={`${styles.item} ${completed ? styles.completedItem : ""} ${waiting ? styles.pausedItem : ""} ${questLocked ? styles.lockedItem : ""}`} data-testid="quest-item" data-state={quest.state} data-locked={questLocked ? "true" : "false"}>
      <button type="button" className={styles.itemname} onClick={() => toggleQuest(quest.id)} aria-expanded={open} data-testid="quest-toggle">
        <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
        <span className={styles.copy}><strong>{quest.title}</strong><small>{done}/{total} · {quest.currentAction || quest.firstStep}</small></span>
      </button>
      <div className={styles.buttons}>
        {!completed && !waiting && <button type="button" disabled={questLocked} className={styles.pause} onClick={() => deferQuest(quest)} aria-label="Defer quest to tomorrow">↥</button>}
        {waiting && <button type="button" disabled={questLocked} className={styles.resume} onClick={() => setQuestStatus(quest, "in_progress")} aria-label="Resume quest">▶</button>}
        {!completed && <button type="button" disabled={questLocked} className={styles.complete} onClick={() => setQuestStatus(quest, "completed")} aria-label="Complete quest">✓</button>}
      </div>
      <div className={`${styles.questDetails} ${open ? styles.questDetailsOpen : ""}`} aria-hidden={!open} data-testid="quest-details" data-open={open ? "true" : "false"}>
        <p>{quest.summary}</p>{questLocked && <p className={styles.lockedNotice}>선행 퀘스트가 완료되면 시작할 수 있어요.</p>}<p className={styles.doneWhen}>{quest.doneWhen}</p>
        <div className={styles.subquests}>
          {quest.steps.map((step) => {
            const locked = isLocked(step);
            return <button key={step.id} type="button" disabled={locked} className={`${styles.subquest} ${step.completed ? styles.subquestCompleted : ""} ${locked ? styles.subquestLocked : ""} ${celebratingStep === step.id ? styles.subquestCelebrating : ""}`} onClick={() => toggleStep(step)} aria-pressed={step.completed} aria-disabled={locked} data-testid="subquest"><span className={styles.subquestCheck}>{locked ? "·" : step.completed ? "✓" : ""}</span><span>{step.label}</span></button>;
          })}
        </div>
        {quest.carryoverCount > 0 && <small className={styles.carryover}>내일로 이어진 퀘스트 · {quest.carryoverCount}회</small>}
      </div>
    </div>
  );
}

export default Item;
