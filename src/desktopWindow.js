import { isTauri } from "@tauri-apps/api/core";
import { PhysicalPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

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
  const dashboard = await WebviewWindow.getByLabel("dashboard");
  if (!dashboard) return;
  await dashboard.show();
  await dashboard.unminimize();
  await dashboard.setFocus();
}

export async function placeOverlayInCorner() {
  if (!isTauri() || getCurrentWindow().label !== "overlay") return;
  const [monitor, size] = await Promise.all([currentMonitor(), getCurrentWindow().outerSize()]);
  if (!monitor) return;
  const { position, size: workAreaSize } = monitor.workArea;
  await getCurrentWindow().setPosition(new PhysicalPosition(
    position.x + workAreaSize.width - size.width - 20,
    position.y + workAreaSize.height - size.height - 20,
  ));
}
