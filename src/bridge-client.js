const BASE_URL = "http://127.0.0.1:39393";
const MUTATIONS = new Set(["/api/report", "/api/quests/manual", "/api/schedule/rebuild", "/api/schedule-settings", "/api/daily-defaults", "/api/schedule/block-report", "/api/schedule/block-move", "/api/schedule/block-discard", "/api/calendar/codex-busy"]);

/** @template T
 * @param {(signal: AbortSignal) => Promise<T> | T} operation
 * @param {AbortSignal | null | undefined} signal
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function bounded(operation, signal, timeoutMs) {
  if (signal?.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError");
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {() => void} */
  let abort = () => {};
  /** @type {Promise<never>} */
  const interrupted = new Promise((_, reject) => {
    abort = () => { const reason = signal?.reason || new DOMException("Cancelled", "AbortError"); controller.abort(reason); reject(reason); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      const error = new DOMException("Bridge request timed out", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return operation(controller.signal);
    }), interrupted]);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

/** @typedef {Omit<RequestInit, "body"> & {body?: unknown, requestId?: string, retry?: boolean}} BridgeOptions */
/** @type {typeof fetch} */
const defaultFetch = (...args) => fetch(...args);
/** @param {{baseUrl?: string, fetchImpl?: typeof fetch, recoverBridge?: () => Promise<unknown>, timeoutMs?: number}} [options] */
export function createBridgeClient({ baseUrl = BASE_URL, fetchImpl = defaultFetch, recoverBridge = async () => {}, timeoutMs = 5000 } = {}) {
  /** @param {string | URL} path @param {BridgeOptions} [options] @returns {Promise<Response>} */
  return async function request(path, { method = "GET", body, requestId, signal, headers, retry = true } = {}) {
    method = method.toUpperCase();
    const url = new URL(path, baseUrl);
    if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith("/api/")) throw new TypeError("Bridge requests must stay inside the configured API.");
    const requestHeaders = new Headers(headers);
    if (requestId !== undefined) requestHeaders.set("X-Request-Id", requestId);
    if (body !== undefined && !requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
    const serialized = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const attempts = retry && (method === "GET" || (["POST", "PUT"].includes(method) && requestId && MUTATIONS.has(url.pathname))) ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await bounded(async requestSignal => {
          const response = await fetchImpl(url.href, { method, headers: requestHeaders, body: serialized, signal: requestSignal });
          // Consume the stream before returning so a lost response body follows
          // the same bounded retry contract as a connection failure.
          const text = await response.text();
          return new Response([204, 205, 304].includes(response.status) ? null : text, { status: response.status, statusText: response.statusText, headers: response.headers });
        }, signal, timeoutMs);
      } catch (error) {
        if (signal?.aborted || (error !== null && typeof error === "object" && "name" in error && error.name === "AbortError") || attempt + 1 >= attempts) throw error;
        await bounded(() => recoverBridge(), signal, timeoutMs);
      }
    }
    throw new Error("Bridge request attempts exhausted");
  };
}

export const bridgeRequest = createBridgeClient({ recoverBridge: async () => {
  const { invoke, isTauri } = await import("@tauri-apps/api/core");
  if (isTauri()) await invoke("ensure_local_bridge");
} });

/** @param {string | URL} resource @param {BridgeOptions} [options] */
export function fetchBridge(resource, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const path = new URL(resource, BASE_URL).pathname;
  const requestId = options.requestId ?? (["POST", "PUT"].includes(method) && MUTATIONS.has(path) ? crypto.randomUUID() : undefined);
  return bridgeRequest(resource, { ...options, method, requestId });
}

/** @param {string} message @param {{handoff?: {state?: string}} | null | undefined} result */
export function savedNotice(message, result) {
  return result?.handoff?.state === "pending" ? `${message} · 로컬 저장 완료, 연결된 서비스로 전달 대기 중` : message;
}
