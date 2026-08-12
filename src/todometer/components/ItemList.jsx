import { useState } from "react";
import { useAppNotice, useQuestGroups } from "../../AppContext.jsx";
import AddItemForm from "./AddItemForm.jsx";
import Item from "./Item.jsx";
import styles from "./ItemList.module.css";

function Group({ title, items, group, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items.length) return null;
  return <section className={styles.group} data-group={group}>
    <button type="button" className={styles.toggle} onClick={() => setOpen((current) => !current)} aria-expanded={open}><span className={styles.arrow}>{open ? "⌄" : "›"}</span><span>{title}</span><small>{items.length}</small></button>
    {open && <div className={styles.panel}>{items.map((quest) => <Item key={quest.id} quest={quest} />)}</div>}
  </section>;
}

function ItemList() {
  const { now, next, waiting, completed } = useQuestGroups();
  const notice = useAppNotice();
  return <div className="item-list">
    <AddItemForm />
    <div className={styles.notice} role="status" aria-live="polite" data-visible={notice ? "true" : "false"}>{notice}</div>
    <Group title="오늘" items={now} group="now" defaultOpen />
    <Group title="다음" items={next} group="next" defaultOpen />
    <Group title="대기" items={waiting} group="waiting" />
    <Group title="완료" items={completed} group="completed" />
    {!now.length && !next.length && !waiting.length && !completed.length && <div className={styles.alldone}>오늘의 퀘스트가 없습니다.</div>}
  </div>;
}

export default ItemList;
