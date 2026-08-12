import { useAppState } from "../../AppContext.jsx";
import styles from "./Progress.module.css";

function Progress() {
  const { board } = useAppState();
  const total = board.quests.reduce((sum, quest) => sum + quest.steps.length, 0);
  const completed = board.quests.reduce((sum, quest) => sum + quest.steps.filter((step) => step.completed).length, 0);
  const paused = board.quests.filter((quest) => quest.status === "paused").reduce((sum, quest) => sum + quest.steps.length, 0);
  const completedWidth = total ? (completed / total) * 100 : 0;
  const pausedWidth = total ? ((completed + paused) / total) * 100 : 0;

  return <div className={styles.progress}><div className={`${styles.progressbar} ${styles.paused}`} style={{ width: `${pausedWidth}%` }} /><div className={`${styles.progressbar} ${styles.completed}`} style={{ width: `${completedWidth}%` }} /></div>;
}

export default Progress;
