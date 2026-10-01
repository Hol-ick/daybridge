import { randomUUID } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { readJsonStrict } from "../storage/json-store.mjs";

export function createRuntimeIdentity(bridgeVersion) {
  return { service: "daybridge", schemaVersion: 1, bridgeVersion, instanceId: randomUUID(), startedAt: new Date().toISOString() };
}

export function isDaybridgeHealth(body) {
  return body?.service === "daybridge" && body.schemaVersion === 1 && body.status === "ok"
    && typeof body.bridgeVersion === "string" && body.bridgeVersion.length <= 128 && /^\d+\.\d+\.\d+\+[a-f0-9]{12}$/i.test(body.bridgeVersion)
    && typeof body.instanceId === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.instanceId)
    && typeof body.startedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.startedAt) && Number.isFinite(Date.parse(body.startedAt));
}

export async function pathsMatch(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const canonical = value => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
  if (canonical(left) === canonical(right)) return true;
  try { return canonical(await realpath(left)) === canonical(await realpath(right)); }
  catch { return false; }
}

export async function readRuntimeProfile(profilePath) {
  if (typeof profilePath !== "string" || !isAbsolute(profilePath)) return { state: "invalid", code: "invalid_profile_path" };
  let profile;
  try { profile = await readJsonStrict(profilePath); }
  catch (error) { return { state: "invalid", code: error.code || "profile_read_failed" }; }
  if (!profile) return { state: "missing" };
  if (typeof profile.maru_root !== "string" || !isAbsolute(profile.maru_root)
    || profile.daybridge_root !== undefined && (typeof profile.daybridge_root !== "string" || !isAbsolute(profile.daybridge_root))) return { state: "invalid", code: "invalid_profile_root" };
  try {
    for (const marker of ["AGENTS.md", "00_Index", "04_Operations_And_Automation"]) await access(join(profile.maru_root, marker));
  } catch { return { state: "unavailable", code: "profile_root_unavailable" }; }
  return { state: "confirmed", maruRoot: resolve(profile.maru_root), sourceRoot: profile.daybridge_root ? resolve(profile.daybridge_root) : null };
}

export async function readRuntimeConfiguration({ dataDir, profilePath }) {
  const profile = await readRuntimeProfile(profilePath);
  const configured = await readJsonStrict(join(dataDir, "config.json"));
  if (configured && (Array.isArray(configured) || configured.handoffSinkDir !== undefined && configured.handoffSinkDir !== null
    && (typeof configured.handoffSinkDir !== "string" || configured.handoffSinkDir.trim() && !isAbsolute(configured.handoffSinkDir)))) throw new TypeError("Invalid handoff configuration; preserve config.json.");
  const discovered = profile.state === "confirmed"
    ? join(profile.maruRoot, "04_Operations_And_Automation", "Memory_System", "reports", "daily", "_system", "daybridge_handoff") : null;
  const explicit = configured && Object.hasOwn(configured, "handoffSinkDir");
  const sink = explicit ? configured.handoffSinkDir : discovered;
  return { profile, explicitSink: Boolean(explicit), config: { schemaVersion: 1, ...configured, handoffSinkDir: typeof sink === "string" && sink.trim() ? resolve(sink.trim()) : null } };
}

export async function runtimeHealth({ identity, dataDir, sourceRoot, locationPath, defaultDataDir, envDataDir, profilePath, dataLocationSource, lastDelivery }) {
  const codes = [];
  let selected = null;
  try {
    const pointer = await readJsonStrict(locationPath);
    if (pointer && (typeof pointer.dataDirectory !== "string" || !isAbsolute(pointer.dataDirectory))) codes.push("pointer_invalid");
    else selected = pointer?.dataDirectory || envDataDir || defaultDataDir;
  } catch { codes.push("pointer_unreadable"); }
  if (selected && !await pathsMatch(selected, dataDir)) codes.push("pointer_runtime_mismatch");
  let configuration;
  try { configuration = await readRuntimeConfiguration({ dataDir, profilePath }); }
  catch { configuration = { profile: await readRuntimeProfile(profilePath), config: {}, invalid: true }; codes.push("config_invalid"); }
  const { profile, config } = configuration;
  if (profile.sourceRoot && !await pathsMatch(profile.sourceRoot, sourceRoot)) codes.push("profile_checkout_mismatch");
  const sink = config.handoffSinkDir || null;
  const recent = lastDelivery && await pathsMatch(lastDelivery.dataDir, dataDir) && (sink ? await pathsMatch(lastDelivery.sinkDir, sink) : !lastDelivery.sinkDir) ? lastDelivery : null;
  const state = configuration.invalid ? "configuration_invalid"
    : !sink ? (configuration.explicitSink || profile.state === "confirmed" ? "sink_unconfigured" : "profile_unconfirmed")
    : recent?.failed ? "delivery_failed"
    : recent?.pending ? "pending"
    : recent?.verifiedAt ? "connected" : "ready";
  const configurationMismatch = { detected: codes.some(code => code.endsWith("_mismatch")), codes };
  return {
    ...identity, status: "ok", dataDir, sourceRoot, logDirectory: join(dataDir, "logs"), handoffSinkDir: sink,
    connected: Boolean(sink) && !configuration.invalid, dataLocationSource, configurationMismatch,
    profile: { state: profile.state, ...(profile.code ? { code: profile.code } : {}) },
    handoffState: { state, profileState: profile.state, sinkConfigured: Boolean(sink), deliveryVerified: Boolean(recent?.verifiedAt && !recent.failed),
      pending: recent?.pending ?? null, failed: recent?.failed ?? null, checkedAt: recent?.checkedAt ?? null },
  };
}
