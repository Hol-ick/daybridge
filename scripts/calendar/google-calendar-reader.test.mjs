import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  calendarEventsToBusyBlocks,
  googleCalendarStorage,
  inspectGoogleCalendarConnection,
  readGoogleCalendarBusyBlocks,
} from "./google-calendar-reader.mjs";

async function fixtureDirectory() { return mkdtemp(join(tmpdir(), "daybridge-calendar-")); }
async function writeJson(directory, filename, value) { await writeFile(join(directory, filename), `${JSON.stringify(value)}\n`, "utf8"); }
const validClient = { installed: { client_id: "desktop-client.apps.googleusercontent.com", client_secret: "not-a-real-secret", redirect_uris: ["http://127.0.0.1"] } };
const validToken = { refresh_token: "not-a-real-refresh-token", access_token: "not-a-real-access-token", expiry_date: 1_800_000_000_000 };
const unprotectFixtureToken = async (value) => value;

test("calendar connection inspection exposes state but never OAuth material", async () => {
  const directory = await fixtureDirectory();
  assert.deepEqual(await inspectGoogleCalendarConnection({ dataDir: directory }), { state: "unconfigured", reason: "oauth_client_missing", canReadBusyBlocks: false });
  await writeJson(directory, "google-oauth-client.json", { installed: { client_id: "missing fields" } });
  assert.deepEqual(await inspectGoogleCalendarConnection({ dataDir: directory }), { state: "attention", reason: "oauth_client_invalid", canReadBusyBlocks: false });
  await writeJson(directory, "google-oauth-client.json", validClient);
  assert.deepEqual(await inspectGoogleCalendarConnection({ dataDir: directory }), { state: "needs_authorization", reason: "authorization_required", canReadBusyBlocks: false });
  await writeJson(directory, "google-calendar-token.dpapi", validToken);
  const status = await inspectGoogleCalendarConnection({ dataDir: directory });
  assert.deepEqual(status, { state: "connected", reason: null, canReadBusyBlocks: true });
  assert.equal(JSON.stringify(status).includes("secret"), false);
  assert.equal(JSON.stringify(status).includes("token"), false);
});

test("calendar storage defaults to Daybridge app data and keeps configuration outside the repository", () => {
  const storage = googleCalendarStorage({ dataDir: "C:/Temp/Daybridge" });
  assert.match(storage.clientPath, /Daybridge[\\/]google-oauth-client\.json$/);
  assert.match(storage.tokenPath, /Daybridge[\\/]google-calendar-token\.dpapi$/);
});

test("events are converted to anonymous, merged Korea-time busy blocks", () => {
  const blocks = calendarEventsToBusyBlocks({
    date: "2026-08-24",
    events: [
      { id: "private-event", summary: "임원 미팅", description: "email@example.com", attendees: [{ email: "person@example.com" }], start: { dateTime: "2026-08-24T01:00:00Z" }, end: { dateTime: "2026-08-24T02:00:00Z" } },
      { id: "overlap", summary: "secret", start: { dateTime: "2026-08-24T01:30:00Z" }, end: { dateTime: "2026-08-24T03:00:00Z" } },
      { id: "all-day", summary: "휴가", start: { date: "2026-08-24" }, end: { date: "2026-08-25" } },
      { id: "transparent", transparency: "transparent", start: { dateTime: "2026-08-24T08:00:00+09:00" }, end: { dateTime: "2026-08-24T09:00:00+09:00" } },
    ],
  });
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    id: blocks[0].id,
    type: "busy",
    startAt: "2026-08-24T00:00:00+09:00",
    endAt: "2026-08-24T23:59:59+09:00",
    locked: true,
  });
  assert.match(blocks[0].id, /^calendar-busy-[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(blocks).includes("private-event"), false);
  assert.equal(JSON.stringify(blocks).includes("email@example.com"), false);
});

test("reader gives the injected adapter in-memory credentials and sanitizes an adapter failure", async () => {
  const directory = await fixtureDirectory();
  await writeJson(directory, "google-oauth-client.json", validClient);
  await writeJson(directory, "google-calendar-token.dpapi", validToken);
  let seen = null;
  const result = await readGoogleCalendarBusyBlocks({
    date: "2026-08-24",
    dataDir: directory,
    unprotectToken: unprotectFixtureToken,
    adapter: { listEvents: async (input) => { seen = input; return [{ id: "hidden", summary: "민감한 일정", start: { dateTime: "2026-08-24T10:00:00+09:00" }, end: { dateTime: "2026-08-24T11:00:00+09:00" } }]; } },
  });
  assert.equal(result.calendar.state, "connected");
  assert.equal(Object.hasOwn(result.busyBlocks[0], "title"), false);
  assert.equal(seen.oauth.client.clientSecret, "not-a-real-secret");
  assert.equal(seen.oauth.token.refreshToken, "not-a-real-refresh-token");

  const failure = await readGoogleCalendarBusyBlocks({ date: "2026-08-24", dataDir: directory, unprotectToken: unprotectFixtureToken, adapter: { listEvents: async () => { throw new Error("refresh_token=do-not-leak"); } } });
  assert.deepEqual(failure, { calendar: { state: "attention", reason: "calendar_read_failed", canReadBusyBlocks: false }, busyBlocks: [] });
});
