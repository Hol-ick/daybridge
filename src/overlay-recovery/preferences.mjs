import { invoke, isTauri } from "@tauri-apps/api/core";

export const RECOVERY_KEY = "daybridge.overlay-recovery.v1";
/** @typedef {{enabled: boolean, delaySeconds: number}} RecoveryConfig */
/** @param {unknown} value @returns {RecoveryConfig} */
export function normalizeRecovery(value) {
  if (value === null || value === undefined) return {enabled: true, delaySeconds: 10};
  const config = /** @type {Record<string,unknown>} */ (value);
  if (typeof config.enabled !== "boolean" || typeof config.delaySeconds !== "number"
    || !Number.isInteger(config.delaySeconds) || config.delaySeconds < 1 || config.delaySeconds > 300) {
    throw new TypeError("복구 대기는 1~300초로 입력해 주세요.");
  }
  return {enabled: config.enabled, delaySeconds: config.delaySeconds};
}
export async function loadRecoveryPreferences() {
  return normalizeRecovery(isTauri() ? await invoke("get_overlay_recovery_settings")
    : JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null"));
}
/** @param {unknown} value */
export async function saveRecoveryPreferences(value) {
  const next = normalizeRecovery(value);
  if (isTauri()) return normalizeRecovery(await invoke("set_overlay_recovery_settings", {settings: next}));
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(next));
  return next;
}
