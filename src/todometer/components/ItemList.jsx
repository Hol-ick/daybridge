import { useState } from "react";
import { useQuestGroups, useAppActions } from "../../AppContext.jsx";
import AddItemForm from "./AddItemForm.jsx";
import Item from "./Item.jsx";
import styles from "./ItemList.module.css";

function Group({ title, items, group }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return <section className={styles.group} data-group={group}>
    <button type="button" className={styles.toggle} onClick={() => setOpen((current) => !current)} aria-expanded={open}><span className={styles.arrow}>{open ? "⌄" : "›"}</span><span>{title}</span><small>{items.length}</small></button>
    {open && <div className={styles.panel}>{items.map((quest, index) => <Item key={quest.id} quest={quest} index={index} />)}</div>}
  </section>;
}

function ItemList() {
  const { pending, paused, completed } = useQuestGroups();
  const { refresh } = useAppActions();
  return <div className="item-list">
    <AddItemForm />
    <section className={styles.droppableSection}>{pending.length ? pending.map((quest, index) => <Item key={quest.id} quest={quest} index={index} />) : <div className={styles.alldone}>오늘의 퀘스트가 없습니다.</div>}</section>
    <Group title="Later" items={paused} group="paused" />
    <Group title="Completed" items={completed} group="completed" />
    <div className={styles.bottomButtons}><button type="button" onClick={() => void refresh()}>sync</button><span> · </span><button type="button" onClick={() => window.location.reload()}>reset view</button></div>
  </div>;
}

export default ItemList;
