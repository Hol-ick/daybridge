import { invoke, isTauri } from "@tauri-apps/api/core";
import { PhysicalPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

const OVERLAY_POSITION_KEY = "daybridge.overlay-position.v1";
// The overlay is deliberately flush with the monitor work-area edge. The
// taskbar is already excluded by `workArea`, so an extra inset makes the
// widget look as if it stopped short of the corner.
const OVERLAY_EDGE_GAP = 0;
const OVERLAY_SNAP_DISTANCE = 64;
export const OVERLAY_COLLAPSED_HEIGHT = 64;
export const OVERLAY_EXPANDED_HEIGHT = 520;
export const OVERLAY_COLLAPSED_WIDTH = 288;
// Keep the actual Windows WebView at this stable size. Its transparent
// interaction region changes with the visible card, but the native surface
// itself never resizes while the user opens or closes the schedule.
export const OVERLAY_CANVAS_WIDTH = 520;
export const OVERLAY_CANVAS_HEIGHT = 620;
// Settings deliberately use a larger, independently positioned native
// viewport. Keeping the form inside the expanding corner card made an open
// dialog get clipped whenever the card collapsed on blur.
export const OVERLAY_SETTINGS_WIDTH = OVERLAY_CANVAS_WIDTH;
export const OVERLAY_SETTINGS_HEIGHT = OVERLAY_CANVAS_HEIGHT;

/** The actual visible and clickable rectangle within the fixed native canvas. */
export function overlayInteractionRegion({ height = OVERLAY_COLLAPSED_HEIGHT, settingsOpen = false } = {}) {
  if (settingsOpen) {
    return { x: 0, y: 0, width: OVERLAY_CANVAS_WIDTH, height: OVERLAY_CANVAS_HEIGHT };
  }
  const visibleHeight = Math.min(
    OVERLAY_EXPANDED_HEIGHT,
    Math.max(OVERLAY_COLLAPSED_HEIGHT, Math.round(height)),
  );
  return {
    x: OVERLAY_CANVAS_WIDTH - OVERLAY_COLLAPSED_WIDTH,
    y: OVERLAY_CANVAS_HEIGHT - visibleHeight,
    width: OVERLAY_COLLAPSED_WIDTH,
    height: visibleHeight,
  };
}

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

let activeOverlayRegion = overlayInteractionRegion();

function shellPositionForVisiblePosition(position, region) {
  return {
    x: Math.round(position.x - region.x),
    y: Math.round(position.y - region.y),
  };
}

function visiblePositionForShellPosition(position, region) {
  return {
    x: Math.round(position.x + region.x),
    y: Math.round(position.y + region.y),
  };
}

/**
 * Change only the visible and clickable part of the fixed transparent canvas.
 * Unlike a WebView resize, this keeps the DirectComposition surface alive while
 * the React card animates from its bottom edge.
 */
export async function setOverlayInteractionRegion(options = {}) {
  const region = overlayInteractionRegion(options);
  activeOverlayRegion = region;
  if (!isTauri() || getCurrentWindow().label !== "overlay") return region;
  await invoke("set_overlay_interaction_region", region);
  return region;
}

async function moveOverlayCanvasToCenter() {
  const windowHandle = getCurrentWindow();
  const [monitor, size] = await Promise.all([currentMonitor(), windowHandle.outerSize()]);
  if (!monitor) return false;
  const nextX = Math.round(monitor.workArea.position.x + (monitor.workArea.size.width - size.width) / 2);
  const nextY = Math.round(monitor.workArea.position.y + (monitor.workArea.size.height - size.height) / 2);
  await windowHandle.setPosition(new PhysicalPosition(nextX, nextY));
  rememberOverlayPosition({ x: nextX, y: nextY });
  await invoke("save_overlay_position", { x: nextX, y: nextY });
  return true;
}

/** Open the settings surface as a true screen-centred modal-sized viewport. */
export async function openOverlaySettingsModal() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return false;
  await setOverlayInteractionRegion({ settingsOpen: true });
  return moveOverlayCanvasToCenter();
}

/** Return the settings viewport to the compact card, flush with the work area. */
export async function closeOverlaySettingsModal() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return false;
  await setOverlayInteractionRegion({ height: OVERLAY_COLLAPSED_HEIGHT });
  await placeOverlayInCorner();
  return true;
}

export async function bindOverlayMagnet({ onSnap } = {}) {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return () => {};
  const windowHandle = getCurrentWindow();
  let timer = null;
  let disposed = false;
  const scheduleSnap = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (disposed) return;
      void snapOverlayToCorner().then((result) => {
        if (!disposed && result?.snapped) onSnap?.(result);
      }).catch(() => {});
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
  if (!isTauri() || getCurrentWindow().label !== "overlay") return { snapped: false, position: null };
  const windowHandle = getCurrentWindow();
  const [monitor, position] = await Promise.all([
    currentMonitor(),
    windowHandle.outerPosition(),
  ]);
  if (!monitor) return { snapped: false, position: null };
  const visiblePosition = visiblePositionForShellPosition(position, activeOverlayRegion);
  const nextVisiblePosition = nearestOverlayCorner(visiblePosition, monitor, activeOverlayRegion);
  const nextShellPosition = shellPositionForVisiblePosition(nextVisiblePosition, activeOverlayRegion);
  const snapped = nextShellPosition.x !== position.x || nextShellPosition.y !== position.y;
  rememberOverlayPosition(nextShellPosition);
  if (snapped) await windowHandle.setPosition(new PhysicalPosition(nextShellPosition.x, nextShellPosition.y));
  await invoke("save_overlay_position", { x: nextShellPosition.x, y: nextShellPosition.y });
  return { snapped, position: nextVisiblePosition };
}

export async function placeOverlayInCorner() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return;
  const windowHandle = getCurrentWindow();
  const monitor = await currentMonitor();
  if (!monitor) return;
  const bounds = overlayBounds(monitor, activeOverlayRegion);
  // The visible card, rather than the invisible canvas around it, attaches to
  // the work-area corner. This preserves the magnetic feeling on every edge.
  const next = shellPositionForVisiblePosition({ x: bounds.maxX, y: bounds.maxY }, activeOverlayRegion);
  await windowHandle.setPosition(new PhysicalPosition(next.x, next.y));
  rememberOverlayPosition(next);
  await invoke("save_overlay_position", { x: next.x, y: next.y });
}
