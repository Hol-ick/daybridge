import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { APPEARANCE_KEY, normalizeAppearance, paletteFor } from "./palettes.js";
import { recordRuntimeEvent } from "../runtime-log.js";

const subscribers = new Set();
function readPreference() {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "null")); }
  catch { return normalizeAppearance(null); }
}
let appearance = readPreference();
/** @param {unknown} next */
function apply(next) {
  const value = normalizeAppearance(next), p = paletteFor(value);
  const root = document.documentElement;
  root.dataset.palette = p.id;
  root.style.colorScheme = p.mode;
  for (const name of ["canvas", "surface", "raised", "field", "ink", "muted", "line", "accent", "onAccent", "paper", "paperInk"]) {
    root.style.setProperty(`--db-${name}`, p[/** @type {keyof typeof p} */ (name)]);
  }
  root.style.setProperty("--db-danger", p.mode === "dark" ? "#ffb0b9" : "#a53149");
  if (appearance.paletteId !== value.paletteId) {
    appearance = value;
    subscribers.forEach(fn => fn());
  }
}
let started = false;
export function initializeAppearance() {
  if (started) return;
  started = true;
  apply(readPreference());
  window.addEventListener("storage", event => { if (event.key === APPEARANCE_KEY || event.key === null) apply(readPreference()); });
  window.addEventListener("focus", () => apply(readPreference()));
  if (isTauri()) void listen("daybridge:appearance-changed", () => apply(readPreference()))
    .then(() => apply(readPreference()))
    .catch(error => recordRuntimeEvent("appearance_listener_error", { error: String(error) }));
}
/** @param {unknown} next */
export function setAppearance(next) {
  const value = normalizeAppearance(next);
  // A failed write must leave the current palette intact.
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value));
  apply(value);
  if (isTauri()) void emit("daybridge:appearance-changed")
    .catch(error => recordRuntimeEvent("appearance_sync_error", { error: String(error) }));
  recordRuntimeEvent("appearance_changed", { paletteId: value.paletteId });
}
/** @param {()=>void} fn */
function subscribe(fn) { subscribers.add(fn); return () => { subscribers.delete(fn); }; }
export function useAppearance() { return useSyncExternalStore(subscribe, () => appearance); }
