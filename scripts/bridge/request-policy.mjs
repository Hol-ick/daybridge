const origins = new Set([
  "http://127.0.0.1:4173", "http://localhost:4173",
  "http://127.0.0.1:5173", "http://localhost:5173",
  "http://127.0.0.1:5174", "http://localhost:5174",
  "http://127.0.0.1:5178", "http://localhost:5178",
  "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
]);

export function allowedOrigin(origin) {
  return origins.has(origin) || /^https?:\/\/tauri\.localhost(?::\d+)?$/.test(origin || "");
}

export function validateRequest({ method, host, origin, contentType, port }) {
  const reject = (status, code) => ({ ok: false, status, code });
  if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host?.toLowerCase())) return reject(403, "untrusted_host");
  if (origin !== undefined && !allowedOrigin(origin)) return reject(403, "untrusted_origin");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && contentType?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return reject(415, "unsupported_media_type");
  }
  return { ok: true, status: 200, code: null };
}

export class RequestError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
