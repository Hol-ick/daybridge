import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KST_TIME_ZONE = "Asia/Seoul";
const CLIENT_FILE = "google-oauth-client.json";
const TOKEN_FILE = "google-calendar-token.dpapi";

/**
 * Google Calendar is a read-only scheduling input. This module deliberately
 * exposes only connection state and anonymous busy intervals to Daybridge.
 * OAuth material stays below the local Daybridge application-data directory.
 */

function defaultDataDir() {
  return resolve(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Daybridge");
}

function validDate(value) {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

function requireDate(value) {
  if (!validDate(value)) throw new TypeError("date must use YYYY-MM-DD format.");
  return value;
}

function dataDirFor(options = {}) {
  return resolve(options.dataDir || defaultDataDir());
}

function readJsonFile(filePath, dependencies = {}) {
  const read = dependencies.readFile || readFile;
  return read(filePath, "utf8").then((value) => JSON.parse(value)).catch(() => null);
}

function clientShape(value) {
  const candidate = value?.installed || value?.web;
  if (!candidate || typeof candidate !== "object") return null;
  const clientId = typeof candidate.client_id === "string" ? candidate.client_id.trim() : "";
  const clientSecret = typeof candidate.client_secret === "string" ? candidate.client_secret.trim() : "";
  const redirectUris = Array.isArray(candidate.redirect_uris) ? candidate.redirect_uris.filter((item) => typeof item === "string" && item.trim()) : [];
  if (!clientId || !clientSecret || !redirectUris.length) return null;
  return { clientId, clientSecret, redirectUris, type: value.installed ? "installed" : "web" };
}

function tokenShape(value) {
  if (!value || typeof value !== "object") return null;
  const refreshToken = typeof value.refresh_token === "string" ? value.refresh_token.trim() : "";
  const accessToken = typeof value.access_token === "string" ? value.access_token.trim() : "";
  if (!refreshToken && !accessToken) return null;
  const expiryDate = Number(value.expiry_date);
  return {
    refreshToken: refreshToken || null,
    accessToken: accessToken || null,
    expiryDate: Number.isFinite(expiryDate) ? expiryDate : null,
    scope: typeof value.scope === "string" ? value.scope : null,
    tokenType: typeof value.token_type === "string" ? value.token_type : null,
  };
}

/** Returns only safe paths for a caller that needs to run the OAuth loopback flow. */
export function googleCalendarStorage(options = {}) {
  const dataDir = dataDirFor(options);
  return Object.freeze({
    dataDir,
    clientPath: join(dataDir, CLIENT_FILE),
    tokenPath: join(dataDir, TOKEN_FILE),
  });
}

/**
 * Inspects local OAuth files without returning their contents. UI callers must
 * use this value instead of reading credentials directly.
 */
export async function inspectGoogleCalendarConnection(options = {}) {
  const storage = googleCalendarStorage(options);
  const read = options.readFile || readFile;
  const [clientRaw, hasToken] = await Promise.all([
    readJsonFile(storage.clientPath, { readFile: read }),
    Promise.resolve((options.existsSync || existsSync)(storage.tokenPath)),
  ]);
  const client = clientShape(clientRaw);
  if (!clientRaw) return Object.freeze({ state: "unconfigured", reason: "oauth_client_missing", canReadBusyBlocks: false });
  if (!client) return Object.freeze({ state: "attention", reason: "oauth_client_invalid", canReadBusyBlocks: false });
  if (!hasToken) return Object.freeze({ state: "needs_authorization", reason: "authorization_required", canReadBusyBlocks: false });
  return Object.freeze({ state: "connected", reason: null, canReadBusyBlocks: true });
}

async function readOAuthMaterial(options = {}) {
  const storage = googleCalendarStorage(options);
  const clientRaw = await readJsonFile(storage.clientPath, { readFile: options.readFile || readFile });
  // The refresh-token file must be Windows-DPAPI encrypted. This module does
  // not know how to decrypt it; the desktop adapter supplies that capability.
  if (typeof options.unprotectToken !== "function") return { client: clientShape(clientRaw), token: null };
  try {
    const encrypted = await (options.readFile || readFile)(storage.tokenPath);
    const plaintext = await options.unprotectToken(encrypted);
    const tokenRaw = JSON.parse(Buffer.isBuffer(plaintext) ? plaintext.toString("utf8") : String(plaintext));
    return { client: clientShape(clientRaw), token: tokenShape(tokenRaw) };
  } catch {
    return { client: clientShape(clientRaw), token: null };
  }
}

function kstParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return values;
}

function asKstIso(date) {
  const parts = kstParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+09:00`;
}

function dateStart(date) { return `${requireDate(date)}T00:00:00+09:00`; }
function dateEnd(date) { return `${requireDate(date)}T23:59:59+09:00`; }

function eventTime(value, fallbackDate) {
  if (!value || typeof value !== "object") return null;
  if (validDate(value.date)) return { allDay: true, date: value.date };
  if (typeof value.dateTime !== "string" || Number.isNaN(Date.parse(value.dateTime))) return null;
  const timestamp = new Date(value.dateTime);
  return { allDay: false, timestamp, iso: asKstIso(timestamp), date: asKstIso(timestamp).slice(0, 10), fallbackDate };
}

function anonymousEventInterval(event, date) {
  if (!event || typeof event !== "object" || event.status === "cancelled" || event.transparency === "transparent") return null;
  const start = eventTime(event.start, date);
  const end = eventTime(event.end, date);
  if (!start || !end) return null;
  const lower = Date.parse(dateStart(date));
  const upper = Date.parse(dateEnd(date));
  let from;
  let to;
  if (start.allDay || end.allDay) {
    const startDate = start.date;
    // Google all-day end dates are exclusive. A missing end is treated as one day.
    const endDate = end.date || startDate;
    if (startDate > date || endDate <= date) return null;
    from = lower;
    to = upper;
  } else {
    from = Date.parse(start.iso);
    to = Date.parse(end.iso);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to < lower || from > upper) return null;
    from = Math.max(from, lower);
    to = Math.min(to, upper);
  }
  if (to <= from) return null;
  return { startAt: asKstIso(new Date(from)), endAt: asKstIso(new Date(to)) };
}

function stableBusyId(date, startAt, endAt, index) {
  const fingerprint = createHash("sha256").update(`${date}|${startAt}|${endAt}|${index}`).digest("hex").slice(0, 12);
  return `calendar-busy-${fingerprint}`;
}

/**
 * Normalizes Google events into non-overlapping anonymous busy blocks. It
 * intentionally discards event title, description, participants, links, IDs,
 * and every other calendar detail before the scheduler can see the result.
 */
export function calendarEventsToBusyBlocks({ date, events = [] } = {}) {
  requireDate(date);
  const intervals = (Array.isArray(events) ? events : [])
    .map((event) => anonymousEventInterval(event, date))
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt) || Date.parse(left.endAt) - Date.parse(right.endAt));
  const merged = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && Date.parse(interval.startAt) <= Date.parse(last.endAt)) {
      if (Date.parse(interval.endAt) > Date.parse(last.endAt)) last.endAt = interval.endAt;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.map((interval, index) => Object.freeze({
    id: stableBusyId(date, interval.startAt, interval.endAt, index),
    type: "busy",
    startAt: interval.startAt,
    endAt: interval.endAt,
    locked: true,
  }));
}

function safeReadFailure(error) {
  if (error && typeof error === "object" && (error.code === "invalid_grant" || error.code === 401)) return "authorization_expired";
  return "calendar_read_failed";
}

/**
 * Reads a single Korea-time day through an injected adapter. The adapter is
 * the only seam that knows a Google client library. It receives OAuth material
 * only in memory and must return an array of Calendar event-shaped records.
 * `unprotectToken` must be a Windows-DPAPI adapter for the local encrypted
 * refresh-token file; plaintext is never written by this module.
 */
export async function readGoogleCalendarBusyBlocks({ date, adapter, ...options } = {}) {
  requireDate(date);
  const connection = await inspectGoogleCalendarConnection(options);
  if (!connection.canReadBusyBlocks) return { calendar: connection, busyBlocks: [] };
  if (!adapter || typeof adapter.listEvents !== "function") {
    return { calendar: Object.freeze({ state: "attention", reason: "calendar_adapter_unavailable", canReadBusyBlocks: false }), busyBlocks: [] };
  }
  const material = await readOAuthMaterial(options);
  if (!material.client || !material.token) {
    return { calendar: Object.freeze({ state: "attention", reason: "oauth_material_unavailable", canReadBusyBlocks: false }), busyBlocks: [] };
  }
  try {
    const events = await adapter.listEvents({
      date,
      timeZone: KST_TIME_ZONE,
      timeMin: dateStart(date),
      timeMax: `${date}T23:59:59+09:00`,
      oauth: material,
    });
    return { calendar: connection, busyBlocks: calendarEventsToBusyBlocks({ date, events }) };
  } catch (error) {
    return { calendar: Object.freeze({ state: "attention", reason: safeReadFailure(error), canReadBusyBlocks: false }), busyBlocks: [] };
  }
}

/** Kept for a simple local preflight without exposing OAuth paths or material. */
export function hasGoogleCalendarConfiguration(options = {}) {
  const storage = googleCalendarStorage(options);
  const exists = options.existsSync || existsSync;
  return exists(storage.clientPath);
}
