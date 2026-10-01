import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDaybridgeHealth, pathsMatch, readRuntimeProfile } from "./bridge/runtime-info.mjs";

function endpoint(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new TypeError("Runtime inspection requires a loopback HTTP origin.");
  return url;
}

async function listening(url, timeoutMs) {
  return await new Promise(resolveResult => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 80) });
    const finish = value => { socket.destroy(); resolveResult(value); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function inspectRuntime({ baseUrl = "http://127.0.0.1:39393", profilePath, timeoutMs = 2000 } = {}) {
  const url = endpoint(baseUrl);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5000) throw new TypeError("Inspection timeout must be 50–5000 ms.");
  if (!await listening(url, Math.min(timeoutMs, 250))) return { state: "unavailable", identityVerified: false };
  let health;
  try {
    const response = await fetch(new URL("/api/health", url), { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) return { state: "foreign_listener", identityVerified: false };
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); return { state: "foreign_listener", identityVerified: false }; }
      chunks.push(Buffer.from(value));
    }
    health = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return { state: "foreign_listener", identityVerified: false }; }
  if (!isDaybridgeHealth(health)) return { state: health?.service === "daybridge" ? "incompatible_bridge" : health?.status === "ok" && typeof health.dataDir === "string" ? "legacy_bridge" : "foreign_listener", identityVerified: false };
  const allowedCodes = ["pointer_invalid", "pointer_unreadable", "pointer_runtime_mismatch", "config_invalid", "profile_checkout_mismatch"];
  const codes = Array.isArray(health.configurationMismatch?.codes) ? health.configurationMismatch.codes.filter(code => allowedCodes.includes(code)) : [];
  let profile = { state: ["confirmed", "missing", "invalid", "unavailable"].includes(health.profile?.state) ? health.profile.state : "unknown" };
  if (profilePath) {
    const local = await readRuntimeProfile(profilePath);
    profile = { state: local.state, ...(local.code ? { code: local.code } : {}) };
    if (local.sourceRoot && !await pathsMatch(local.sourceRoot, health.sourceRoot)) codes.push("profile_checkout_mismatch");
    if (local.state !== "confirmed") codes.push("inspection_profile_unconfirmed");
  }
  const mismatch = [...new Set(codes)];
  const detected = mismatch.some(code => code.endsWith("_mismatch"));
  const handoffState = ["configuration_invalid", "sink_unconfigured", "profile_unconfirmed", "delivery_failed", "pending", "connected", "ready"].includes(health.handoffState?.state) ? health.handoffState.state : "unknown";
  return {
    state: detected ? "configuration_mismatch" : mismatch.length ? "configuration_attention" : handoffState,
    identityVerified: true, service: health.service, schemaVersion: health.schemaVersion,
    bridgeVersion: health.bridgeVersion, instanceId: health.instanceId, startedAt: health.startedAt,
    dataLocationSource: ["pointer", "environment", "default"].includes(health.dataLocationSource) ? health.dataLocationSource : "unknown", configurationMismatch: { detected, codes: mismatch }, profile,
    handoffState: health.handoffState ? {
      state: handoffState, sinkConfigured: health.handoffState.sinkConfigured === true,
      deliveryVerified: health.handoffState.deliveryVerified === true, pending: Number.isInteger(health.handoffState.pending) && health.handoffState.pending >= 0 ? health.handoffState.pending : null,
      failed: Number.isInteger(health.handoffState.failed) && health.handoffState.failed >= 0 ? health.handoffState.failed : null, checkedAt: typeof health.handoffState.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(health.handoffState.checkedAt) ? health.handoffState.checkedAt : null,
    } : { state: "unknown" },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = { "--base-url": "baseUrl", "--profile": "profilePath" }[process.argv[index]];
    if (!key || !process.argv[index + 1]) throw new TypeError("Use --base-url <loopback-origin> and optional --profile <local-profile>.");
    options[key] = process.argv[index + 1];
  }
  console.log(JSON.stringify(await inspectRuntime(options), null, 2));
}
