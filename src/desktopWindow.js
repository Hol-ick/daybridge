import { invoke, isTauri } from "@tauri-apps/api/core";
import { PhysicalPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

const OVERLAY_POSITION_KEY = "daybridge.overlay-position.v1";
const OVERLAY_EDGE_GAP = 8;
const OVERLAY_SNAP_DISTANCE = 64;

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
}

export async function placeOverlayInCorner() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return;
  const windowHandle = getCurrentWindow();
  const [monitor, size] = await Promise.all([currentMonitor(), windowHandle.outerSize()]);
  if (!monitor) return;
  const bounds = overlayBounds(monitor, size);
  const saved = readOverlayPosition();
  const next = saved
    ? new PhysicalPosition(Math.min(bounds.maxX, Math.max(bounds.minX, saved.x)), Math.min(bounds.maxY, Math.max(bounds.minY, saved.y)))
    : new PhysicalPosition(bounds.maxX, bounds.maxY);
  await windowHandle.setPosition(next);
  rememberOverlayPosition(next);
}
