import { useRef } from "react";
import { useAppActions } from "../../AppContext.jsx";
import styles from "./AddItemForm.module.css";

function AddItemForm() {
  const inputRef = useRef(null);
  const { addQuest } = useAppActions();

  function addItem(event) {
    event.preventDefault();
    addQuest(inputRef.current?.value ?? "");
    if (inputRef.current) { inputRef.current.value = ""; inputRef.current.focus(); }
  }

  return <form className={styles.form} onSubmit={addItem}><input ref={inputRef} placeholder="Add new quest" aria-label="Add new quest" /><button type="submit" aria-label="Add quest" /></form>;
}

export default AddItemForm;
