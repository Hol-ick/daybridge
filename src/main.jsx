import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import MemoSurface from "./MemoSurface.jsx";
import { recordRuntimeEvent } from "./runtime-log.js";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { mountAfterBridgeReady } from "./desktop-bootstrap.js";
import "./todometer/styles/variables.css";
import "./todometer/index.css";

window.addEventListener("error", (event) => {
  recordRuntimeEvent("window_error", { message: event.error?.message || event.message || "unknown error" });
});
window.addEventListener("unhandledrejection", (event) => {
  recordRuntimeEvent("unhandled_rejection", { reason: event.reason?.message || String(event.reason || "unknown rejection") });
});
recordRuntimeEvent("webview_boot", { mode: import.meta.env.MODE });

const root = document.getElementById("root");
if (!root) throw new Error("Daybridge root element is missing");
const renderer = ReactDOM.createRoot(root);
const memoSurface = new URLSearchParams(window.location.search).get("surface") === "memo";
void mountAfterBridgeReady({
  desktop: isTauri() && !memoSurface,
  ensureBridge: () => invoke("wait_for_initial_bridge"),
  report: recordRuntimeEvent,
  mount: () => renderer.render(
    <React.StrictMode>
      {memoSurface ? <MemoSurface /> : <App />}
    </React.StrictMode>,
  ),
});
