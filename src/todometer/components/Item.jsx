import { useState } from "react";
import { useAppActions, useAppState } from "../../AppContext.jsx";
import styles from "./Item.module.css";

function Item({ quest, index }) {
  const { toggleQuest, setQuestStatus, reportQuest } = useAppActions();
  const { expandedQuestId } = useAppState();
  const [celebratingStep, setCelebratingStep] = useState("");
  const completed = quest.status === "completed";
  const paused = quest.status === "paused";
  const open = expandedQuestId === quest.id;
  const done = quest.steps.filter((step) => step.completed).length;

  function toggleStep(step) {
    const steps = quest.steps.map((current) => current.id === step.id ? { ...current, completed: !current.completed } : { ...current });
    const nextStatus = steps.length > 0 && steps.every((current) => current.completed) ? "completed" : "in_progress";
    setCelebratingStep(step.id);
    window.setTimeout(() => setCelebratingStep(""), 520);
    void reportQuest({ questId: quest.id, status: nextStatus, steps, note: `${steps.filter((current) => current.completed).length}/${steps.length} sub-quests checked`, nextAction: steps.find((current) => !current.completed)?.label ?? "" });
  }

  return (
    <div className={`${styles.item} ${completed ? styles.completedItem : ""} ${paused ? styles.pausedItem : ""}`} data-testid="quest-item">
      <button type="button" className={styles.itemname} onClick={() => toggleQuest(quest.id)} aria-expanded={open} data-testid="quest-toggle">
        <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
        <span className={styles.copy}><strong>{quest.title}</strong><small>{done}/{quest.steps.length} · {quest.project}</small></span>
      </button>
      <div className={styles.buttons}>
        {!paused && !completed && <button type="button" className={styles.pause} onClick={() => setQuestStatus(quest, "paused")} aria-label="Pause quest" />}
        {(paused || completed) && <button type="button" className={styles.resume} onClick={() => setQuestStatus(quest, "in_progress")} aria-label="Resume quest" />}
        {!completed && <button type="button" className={styles.complete} onClick={() => setQuestStatus(quest, "completed")} aria-label="Complete quest" />}
      </div>
      <div className={`${styles.questDetails} ${open ? styles.questDetailsOpen : ""}`} aria-hidden={!open} data-testid="quest-details" data-open={open ? "true" : "false"}>
        <p>{quest.summary}</p><p className={styles.doneWhen}>{quest.doneWhen}</p>
        <div className={styles.subquests}>
          {quest.steps.map((step) => <button key={step.id} type="button" className={`${styles.subquest} ${step.completed ? styles.subquestCompleted : ""} ${celebratingStep === step.id ? styles.subquestCelebrating : ""}`} onClick={() => toggleStep(step)} aria-pressed={step.completed} data-testid="subquest"><span className={styles.subquestCheck}>{step.completed ? "✓" : ""}</span><span>{step.label}</span></button>)}
        </div>
      </div>
    </div>
  );
}

export default Item;
