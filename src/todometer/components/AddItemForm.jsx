import { useState } from "react";
import { useAppActions } from "../../AppContext.jsx";
import styles from "./AddItemForm.module.css";

function AddItemForm() {
  const { refresh } = useAppActions();
  const [refreshing, setRefreshing] = useState(false);

  async function loadBriefing() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh({ announce: true });
    } finally {
      setRefreshing(false);
    }
  }

  return <div className={styles.form}>
    <button type="button" className={styles.briefingButton} onClick={() => void loadBriefing()} disabled={refreshing} aria-label="브리핑 불러오기">
      <span>{refreshing ? "브리핑 불러오는 중…" : "브리핑 불러오기"}</span>
      <span className={styles.refreshIcon} aria-hidden="true">↻</span>
    </button>
  </div>;
}

export default AddItemForm;
