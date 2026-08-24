import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { beginGoogleCalendarAuthorization, finishGoogleCalendarAuthorization } from "./google-oauth.mjs";

const client = { installed: { client_id: "desktop.apps.googleusercontent.com", client_secret: "not-a-real-secret", redirect_uris: ["http://127.0.0.1"] } };
const redirectUri = "http://127.0.0.1:39393/api/calendar/oauth/callback";

async function fixtureDirectory() { return mkdtemp(join(tmpdir(), "daybridge-oauth-")); }
function fakeGoogle(tokens = { refresh_token: "test-refresh", access_token: "test-access", expiry_date: 1_800_000_000_000 }) {
  class OAuth2 {
    generateAuthUrl(input) { return `https://accounts.example/authorize?state=${encodeURIComponent(input.state)}&scope=${encodeURIComponent(input.scope[0])}`; }
    async getToken(code) { assert.equal(code, "approval-code"); return { tokens }; }
  }
  return { auth: { OAuth2 } };
}

test("OAuth start requires a local client configuration and includes only the read-only scope", async () => {
  const dataDir = await fixtureDirectory();
  assert.deepEqual(await beginGoogleCalendarAuthorization({ dataDir, redirectUri, state: "one", googleApi: fakeGoogle() }), { state: "unconfigured", reason: "oauth_client_missing", authorizationUrl: null });
  await writeFile(join(dataDir, "google-oauth-client.json"), JSON.stringify(client));
  const started = await beginGoogleCalendarAuthorization({ dataDir, redirectUri, state: "one", googleApi: fakeGoogle() });
  assert.equal(started.state, "needs_authorization");
  assert.match(started.authorizationUrl, /state=one/);
  assert.match(started.authorizationUrl, /calendar.readonly/);
  assert.equal(started.authorizationUrl.includes("not-a-real-secret"), false);
});

test("OAuth finish persists only the provided encrypted token bytes", async () => {
  const dataDir = await fixtureDirectory();
  await writeFile(join(dataDir, "google-oauth-client.json"), JSON.stringify(client));
  const result = await finishGoogleCalendarAuthorization({ dataDir, redirectUri, code: "approval-code", googleApi: fakeGoogle(), protectToken: async () => Buffer.from("encrypted-token", "utf8") });
  assert.deepEqual(result, { state: "connected", reason: null });
  assert.equal((await readFile(join(dataDir, "google-calendar-token.dpapi"), "utf8")), "encrypted-token");
});

test("OAuth finish never writes a partial token without a refresh token", async () => {
  const dataDir = await fixtureDirectory();
  await writeFile(join(dataDir, "google-oauth-client.json"), JSON.stringify(client));
  const result = await finishGoogleCalendarAuthorization({ dataDir, redirectUri, code: "approval-code", googleApi: fakeGoogle({ access_token: "short-lived" }), protectToken: async () => Buffer.from("must-not-write") });
  assert.deepEqual(result, { state: "attention", reason: "refresh_token_missing" });
});
