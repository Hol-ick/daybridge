import { google } from "googleapis";

const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/**
 * Concrete Google Calendar adapter for the reader seam.
 *
 * This adapter only issues `events.list`; it has no methods capable of
 * creating, modifying, or deleting calendar data. Its dependency can be
 * replaced in tests, while production uses the installed `googleapis` SDK.
 */
export function createGoogleCalendarAdapter({ googleApi = google, calendarId = "primary" } = {}) {
  const safeCalendarId = typeof calendarId === "string" && calendarId.trim() ? calendarId.trim() : "primary";
  return Object.freeze({
    async listEvents({ date, timeZone, timeMin, timeMax, oauth } = {}) {
      if (!date || !timeZone || !timeMin || !timeMax || !oauth?.client || !oauth?.token) {
        throw new TypeError("A date range and in-memory OAuth material are required.");
      }
      const redirectUri = oauth.client.redirectUris?.[0];
      const auth = new googleApi.auth.OAuth2(oauth.client.clientId, oauth.client.clientSecret, redirectUri);
      auth.setCredentials({
        access_token: oauth.token.accessToken || undefined,
        refresh_token: oauth.token.refreshToken || undefined,
        expiry_date: oauth.token.expiryDate || undefined,
        scope: oauth.token.scope || READ_ONLY_SCOPE,
        token_type: oauth.token.tokenType || "Bearer",
      });
      const calendar = googleApi.calendar({ version: "v3", auth });
      const response = await calendar.events.list({
        calendarId: safeCalendarId,
        timeMin,
        timeMax,
        timeZone,
        singleEvents: true,
        orderBy: "startTime",
        showDeleted: false,
        maxResults: 250,
        // The service must not even request event summaries, people, links, or descriptions.
        fields: "items(status,transparency,start,end)",
      });
      return Array.isArray(response?.data?.items) ? response.data.items : [];
    },
  });
}

export { READ_ONLY_SCOPE };
