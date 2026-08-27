import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { recordRuntimeEvent } from "./runtime-log.js";
import "./todometer/styles/variables.css";
import "./todometer/index.css";

window.addEventListener("error", (event) => {
  recordRuntimeEvent("window_error", { message: event.error?.message || event.message || "unknown error" });
});
window.addEventListener("unhandledrejection", (event) => {
  recordRuntimeEvent("unhandled_rejection", { reason: event.reason?.message || String(event.reason || "unknown rejection") });
});
recordRuntimeEvent("webview_boot", { mode: import.meta.env.MODE });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
