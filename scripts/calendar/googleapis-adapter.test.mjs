import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleCalendarAdapter, READ_ONLY_SCOPE } from "./googleapis-adapter.mjs";

test("Google adapter only lists expanded events with a read-only credential", async () => {
  const calls = [];
  let credential = null;
  class OAuth2 {
    constructor(...args) { this.args = args; }
    setCredentials(value) { credential = value; }
  }
  const fakeGoogle = {
    auth: { OAuth2 },
    calendar: ({ version, auth }) => ({
      events: { list: async (request) => { calls.push({ version, auth, request }); return { data: { items: [{ id: "raw-event" }] } }; } },
    }),
  };
  const adapter = createGoogleCalendarAdapter({ googleApi: fakeGoogle });
  const events = await adapter.listEvents({
    date: "2026-08-24",
    timeZone: "Asia/Seoul",
    timeMin: "2026-08-24T00:00:00+09:00",
    timeMax: "2026-08-24T23:59:59+09:00",
    oauth: {
      client: { clientId: "client", clientSecret: "secret", redirectUris: ["http://127.0.0.1"] },
      token: { refreshToken: "refresh", accessToken: "access", expiryDate: 1234 },
    },
  });
  assert.deepEqual(events, [{ id: "raw-event" }]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, {
    calendarId: "primary",
    timeMin: "2026-08-24T00:00:00+09:00",
    timeMax: "2026-08-24T23:59:59+09:00",
    timeZone: "Asia/Seoul",
    singleEvents: true,
    orderBy: "startTime",
    showDeleted: false,
    maxResults: 250,
    fields: "items(status,transparency,start,end)",
  });
  assert.equal(credential.scope, READ_ONLY_SCOPE);
  assert.equal(calls[0].auth.args[0], "client");
});

test("Google adapter rejects missing OAuth material before constructing a client", async () => {
  const adapter = createGoogleCalendarAdapter({ googleApi: { auth: { OAuth2: class {} }, calendar: () => ({}) } });
  await assert.rejects(adapter.listEvents({}), /OAuth material/);
});
