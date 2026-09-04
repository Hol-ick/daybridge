import { invoke, isTauri } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

const OVERLAY_POSITION_KEY = "daybridge.overlay-position.v1";
// The overlay is deliberately flush with the monitor work-area edge. The
// taskbar is already excluded by `workArea`, so an extra inset makes the
// widget look as if it stopped short of the corner.
const OVERLAY_EDGE_GAP = 0;
const OVERLAY_SNAP_DISTANCE = 64;
export const OVERLAY_COLLAPSED_HEIGHT = 64;
export const OVERLAY_EXPANDED_HEIGHT = 520;
export const OVERLAY_COLLAPSED_WIDTH = 288;
export const OVERLAY_MODAL_WIDTH = 420;

function readOverlayPosition() {
  try {
    const value = JSON.parse(localStorage.getItem(OVERLAY_POSITION_KEY) || "null");
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? { x: value.x, y: value.y } : null;
  } catch { return null; }
}

function rememberOverlayPosition(position) {
  try { localStorage.setItem(OVERLAY_POSITION_KEY, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) })); } catch { /* position memory is optional */ }
}

function overlayBounds(monitor, size) {
  const minX = monitor.workArea.position.x + OVERLAY_EDGE_GAP;
  const minY = monitor.workArea.position.y + OVERLAY_EDGE_GAP;
  const maxX = monitor.workArea.position.x + monitor.workArea.size.width - size.width - OVERLAY_EDGE_GAP;
  const maxY = monitor.workArea.position.y + monitor.workArea.size.height - size.height - OVERLAY_EDGE_GAP;
  return { minX, minY, maxX: Math.max(minX, maxX), maxY: Math.max(minY, maxY) };
}

export function nearestOverlayCorner(position, monitor, size) {
  const bounds = overlayBounds(monitor, size);
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
  ];
  const nearest = corners.reduce((best, corner) => {
    const distance = Math.hypot(position.x - corner.x, position.y - corner.y);
    return distance < best.distance ? { corner, distance } : best;
  }, { corner: position, distance: Number.POSITIVE_INFINITY });
  return nearest.distance <= OVERLAY_SNAP_DISTANCE ? nearest.corner : position;
}

export function currentSurface() {
  if (!isTauri()) return new URLSearchParams(window.location.search).get("surface") === "overlay" ? "overlay" : "dashboard";
  return getCurrentWindow().label === "overlay" ? "overlay" : "dashboard";
}

export async function openDashboard() {
  if (!isTauri()) {
    const url = new URL(window.location.href);
    url.searchParams.set("surface", "dashboard");
    window.location.assign(url.toString());
    return;
  }
  await invoke("open_dashboard");
}

export async function startOverlayDrag() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return false;
  await getCurrentWindow().startDragging();
  return true;
}

/** Resize the overlay while keeping its bottom edge anchored in place. */
export async function resizeOverlay(height, width = null) {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return false;
  const windowHandle = getCurrentWindow();
  const targetHeight = Math.max(OVERLAY_COLLAPSED_HEIGHT, Math.round(height));
  const targetWidth = Math.max(OVERLAY_COLLAPSED_WIDTH, Math.round(width ?? OVERLAY_COLLAPSED_WIDTH));
  const [monitor, position, size] = await Promise.all([
    currentMonitor(),
    windowHandle.outerPosition(),
    windowHandle.outerSize(),
  ]);
  if (!monitor) return false;
  const bottom = position.y + size.height;
  const right = position.x + size.width;
  const bounds = overlayBounds(monitor, { width: targetWidth, height: targetHeight });
  const nextX = Math.min(bounds.maxX, Math.max(bounds.minX, right - targetWidth));
  const nextY = Math.min(bounds.maxY, Math.max(bounds.minY, bottom - targetHeight));
  await windowHandle.setSize(new PhysicalSize(targetWidth, targetHeight));
  await windowHandle.setPosition(new PhysicalPosition(nextX, nextY));
  rememberOverlayPosition({ x: nextX, y: nextY });
  await invoke("save_overlay_position", { x: Math.round(nextX), y: Math.round(nextY) });
  return true;
}

export async function bindOverlayMagnet() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return () => {};
  const windowHandle = getCurrentWindow();
  let timer = null;
  let disposed = false;
  const scheduleSnap = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!disposed) void snapOverlayToCorner();
    }, 180);
  };
  const unlisten = await windowHandle.onMoved(scheduleSnap);
  return () => {
    disposed = true;
    if (timer) window.clearTimeout(timer);
    void unlisten();
  };
}

export async function snapOverlayToCorner() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return;
  const windowHandle = getCurrentWindow();
  const [monitor, position, size] = await Promise.all([
    currentMonitor(),
    windowHandle.outerPosition(),
    windowHandle.outerSize(),
  ]);
  if (!monitor) return;
  const next = nearestOverlayCorner(position, monitor, size);
  rememberOverlayPosition(next);
  if (next.x !== position.x || next.y !== position.y) await windowHandle.setPosition(new PhysicalPosition(next.x, next.y));
  await invoke("save_overlay_position", { x: Math.round(next.x), y: Math.round(next.y) });
}

export async function placeOverlayInCorner() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return;
  const windowHandle = getCurrentWindow();
  const [monitor, size] = await Promise.all([currentMonitor(), windowHandle.outerSize()]);
  if (!monitor) return;
  const bounds = overlayBounds(monitor, size);
  // Startup is deterministic: always place the widget flush with the
  // current monitor's work-area bottom-right corner. User drags still work
  // during the session, but a stale saved position must not make the widget
  // appear somewhere unexpected after login, a display change, or a restart.
  const next = new PhysicalPosition(bounds.maxX, bounds.maxY);
  await windowHandle.setPosition(next);
  rememberOverlayPosition(next);
  await invoke("save_overlay_position", { x: Math.round(next.x), y: Math.round(next.y) });
}
