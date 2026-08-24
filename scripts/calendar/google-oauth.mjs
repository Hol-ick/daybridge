import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { google } from "googleapis";

import { googleCalendarStorage } from "./google-calendar-reader.mjs";
import { READ_ONLY_SCOPE } from "./googleapis-adapter.mjs";

const DPAPI_PROTECT = [
  "Add-Type -AssemblyName System.Security",
  "$raw = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
  "$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser",
  "$sealed = [Security.Cryptography.ProtectedData]::Protect($raw, $null, $scope)",
  "[Console]::Out.Write([Convert]::ToBase64String($sealed))",
].join("; ");
const DPAPI_UNPROTECT = [
  "Add-Type -AssemblyName System.Security",
  "$sealed = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
  "$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser",
  "$raw = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, $scope)",
  "[Console]::Out.Write([Convert]::ToBase64String($raw))",
].join("; ");

function clientCredentials(value) {
  const candidate = value?.installed || value?.web;
  const clientId = typeof candidate?.client_id === "string" ? candidate.client_id.trim() : "";
  const clientSecret = typeof candidate?.client_secret === "string" ? candidate.client_secret.trim() : "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function readClientCredentials(options = {}) {
  const storage = googleCalendarStorage(options);
  try { return clientCredentials(JSON.parse(await (options.readFile || readFile)(storage.clientPath, "utf8"))); } catch { return null; }
}

function safeToken(tokens) {
  const refreshToken = typeof tokens?.refresh_token === "string" ? tokens.refresh_token.trim() : "";
  if (!refreshToken) return null;
  return {
    refresh_token: refreshToken,
    access_token: typeof tokens.access_token === "string" ? tokens.access_token : null,
    expiry_date: Number.isFinite(Number(tokens.expiry_date)) ? Number(tokens.expiry_date) : null,
    scope: typeof tokens.scope === "string" ? tokens.scope : READ_ONLY_SCOPE,
    token_type: typeof tokens.token_type === "string" ? tokens.token_type : "Bearer",
  };
}

function runPowerShell(script, input, { spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", () => reject(new Error("Windows credential protection is unavailable.")));
    child.on("close", (code) => code === 0 && stdout.trim() ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || "Windows credential protection failed.")));
    child.stdin.end(input);
  });
}

/** Encrypts a byte buffer for the current Windows user with DPAPI. */
export async function protectTokenWithDpapi(value, options = {}) {
  const encoded = Buffer.from(value).toString("base64");
  const sealed = await runPowerShell(DPAPI_PROTECT, encoded, options);
  return Buffer.from(sealed, "utf8");
}

/** Decrypts a Daybridge token only in this Windows user session. */
export async function unprotectTokenWithDpapi(value, options = {}) {
  const sealed = Buffer.isBuffer(value) ? value.toString("utf8") : String(value || "");
  const raw = await runPowerShell(DPAPI_UNPROTECT, sealed, options);
  return Buffer.from(raw, "base64");
}

async function atomicWrite(path, value, options = {}) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await (options.mkdir || mkdir)(dirname(path), { recursive: true });
  await (options.writeFile || writeFile)(temporary, value);
  await (options.rename || rename)(temporary, path);
}

function oauthClient(credentials, redirectUri, googleApi = google) {
  return new googleApi.auth.OAuth2(credentials.clientId, credentials.clientSecret, redirectUri);
}

/** Creates a loopback authorization URL. It never persists the OAuth state or exposes credentials. */
export async function beginGoogleCalendarAuthorization({ redirectUri, state = randomBytes(24).toString("base64url"), googleApi = google, ...options } = {}) {
  if (typeof redirectUri !== "string" || !redirectUri.startsWith("http://127.0.0.1:")) throw new TypeError("A local loopback redirect URI is required.");
  const credentials = await readClientCredentials(options);
  if (!credentials) return { state: "unconfigured", reason: "oauth_client_missing", authorizationUrl: null };
  const authorizationUrl = oauthClient(credentials, redirectUri, googleApi).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [READ_ONLY_SCOPE],
    state,
  });
  return { state: "needs_authorization", reason: null, authorizationUrl };
}

/** Exchanges a user-approved loopback code and writes only a DPAPI ciphertext below local app data. */
export async function finishGoogleCalendarAuthorization({ code, redirectUri, googleApi = google, protectToken = protectTokenWithDpapi, ...options } = {}) {
  if (typeof code !== "string" || !code.trim()) return { state: "attention", reason: "authorization_code_missing" };
  if (typeof redirectUri !== "string" || !redirectUri.startsWith("http://127.0.0.1:")) throw new TypeError("A local loopback redirect URI is required.");
  const credentials = await readClientCredentials(options);
  if (!credentials) return { state: "unconfigured", reason: "oauth_client_missing" };
  try {
    const response = await oauthClient(credentials, redirectUri, googleApi).getToken(code.trim());
    const token = safeToken(response?.tokens);
    if (!token) return { state: "attention", reason: "refresh_token_missing" };
    const storage = googleCalendarStorage(options);
    const ciphertext = await protectToken(Buffer.from(JSON.stringify(token), "utf8"));
    await atomicWrite(storage.tokenPath, ciphertext, options);
    return { state: "connected", reason: null };
  } catch {
    return { state: "attention", reason: "authorization_exchange_failed" };
  }
}
