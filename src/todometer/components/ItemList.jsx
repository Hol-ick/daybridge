import { useState } from "react";
import { useQuestGroups, useAppActions } from "../../AppContext.jsx";
import AddItemForm from "./AddItemForm.jsx";
import Item from "./Item.jsx";
import styles from "./ItemList.module.css";

function Group({ title, items, group, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!items.length) return null;
  return <section className={styles.group} data-group={group}>
    <button type="button" className={styles.toggle} onClick={() => setOpen((current) => !current)} aria-expanded={open}><span className={styles.arrow}>{open ? "⌄" : "›"}</span><span>{title}</span><small>{items.length}</small></button>
    {open && <div className={styles.panel}>{items.map((quest, index) => <Item key={quest.id} quest={quest} index={index} />)}</div>}
  </section>;
}

function ItemList() {
  const { now, next, waiting, completed } = useQuestGroups();
  const { refresh } = useAppActions();
  return <div className="item-list">
    <AddItemForm />
    <Group title="Now" items={now} group="now" defaultOpen />
    <Group title="Next" items={next} group="next" defaultOpen />
    <Group title="Waiting" items={waiting} group="waiting" />
    <Group title="Completed" items={completed} group="completed" />
    {!now.length && !next.length && !waiting.length && !completed.length && <div className={styles.alldone}>오늘의 퀘스트가 없습니다.</div>}
    <div className={styles.bottomButtons}><button type="button" onClick={() => void refresh()}>sync</button></div>
  </div>;
}

export default ItemList;
