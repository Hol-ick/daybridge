import { useAppState } from "../../AppContext.jsx";
import styles from "./TodoDate.module.css";

function TodoDate() {
  const { board } = useAppState();
  const date = new Date(`${board.activityDate}T00:00:00+09:00`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", day: "numeric", month: "short", year: "numeric", weekday: "long" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";

  return (
    <div className={styles.date}>
      <div className={styles.calendar}>
        <div className={styles.day}>{get("day")}</div>
        <div className={styles.my}><div className={styles.month}>{get("month")}</div><div className={styles.year}>{get("year")}</div></div>
      </div>
      <div className="today">{get("weekday")}</div>
    </div>
  );
}

export default TodoDate;
