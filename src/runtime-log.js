import { invoke, isTauri } from "@tauri-apps/api/core";

const BRIDGE_URL = "http://127.0.0.1:39393";
const MAX_EVENT_LENGTH = 80;

function eventName(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_.:-]/g, "_")
    .slice(0, MAX_EVENT_LENGTH) || "unknown";
}

function currentSurface() {
  if (typeof document === "undefined") return "unknown";
  return document.body?.dataset?.surface || new URLSearchParams(window.location.search).get("surface") || "unknown";
}

function safeDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  return Object.fromEntries(Object.entries(details).slice(0, 20).map(([key, value]) => {
    if (typeof value === "string") return [key, value.slice(0, 500)];
    if (typeof value === "number" || typeof value === "boolean" || value === null) return [key, value];
    return [key, String(value).slice(0, 500)];
  }));
}

/**
 * Record a sanitized runtime event in the native log (packaged app) or the
 * local bridge log (browser/dev mode). Logging is best-effort and never blocks
 * the widget's UI or data flow.
 */
export function recordRuntimeEvent(name, details = {}) {
  const payload = {
    schemaVersion: 1,
    event: eventName(name),
    occurredAt: new Date().toISOString(),
    surface: currentSurface(),
    details: safeDetails(details),
  };
  if (isTauri()) {
    const nativeDetails = JSON.stringify({
      ...payload.details,
      surface: payload.surface,
      clientOccurredAt: payload.occurredAt,
    });
    void invoke("record_runtime_event", { event: payload.event, details: nativeDetails }).catch(() => {});
    return;
  }
  const bridgePayload = JSON.stringify({
    event: payload.event,
    occurredAt: payload.occurredAt,
    surface: payload.surface,
    details: payload.details,
  });
  void fetch(`${BRIDGE_URL}/api/runtime-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bridgePayload,
  }).catch(() => {});
}
