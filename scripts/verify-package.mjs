import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash, randomBytes} from "node:crypto";
import {once} from "node:events";
import {copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

function startupValue() {
  const shell = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $key='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; $value=(Get-ItemProperty -LiteralPath $key -Name Daybridge -ErrorAction SilentlyContinue).Daybridge; ConvertTo-Json -InputObject $value -Compress"], {encoding: "utf8", timeout: 30000, windowsHide: true});
  if (result.status !== 0) throw new Error(`Could not observe the existing Windows startup value (${result.error?.code || result.status})`);
  return result.stdout.trim();
}

async function readEventually(path, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {return JSON.parse(await readFile(path, "utf8"));}
    catch (error) {if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;}
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Package validation exited before readiness");
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  throw new Error("Package validation readiness timed out");
}

function processExists(pid) {try {process.kill(pid, 0); return true;} catch (error) {if (error.code === "ESRCH") return false; throw error;}}
async function stopped(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && processExists(pid)) await new Promise(resolveWait => setTimeout(resolveWait, 50));
  assert.equal(processExists(pid), false, "Owned bridge survived the validation process");
}
async function json(baseUrl, path, options) {
  const response = await fetch(baseUrl + path, {...options, signal: AbortSignal.timeout(5000)});
  return {status: response.status, body: await response.json()};
}

/** Executes only a marker-bearing validation build copied to a fresh installation directory. */
export async function verifyPackage({executablePath}) {
  assert.equal(process.platform, "win32", "Package verification requires Windows");
  const executable = resolve(executablePath);
  const binary = await readFile(executable);
  assert(binary.includes(Buffer.from("daybridge-package-validation-v1")), "This executable has no safe package validation mode; do not launch it");
  const resources = join(dirname(executable), "bridge-runtime");
  const manifest = JSON.parse(await readFile(join(resources, "runtime-manifest.json"), "utf8"));
  const originalStartup = startupValue();
  const installation = await mkdtemp(join(tmpdir(), "daybridge-package-exe-"));
  const fixtures = [];
  let child;
  let exited;
  let nativeError = "";
  try {
    const copied = join(installation, "daybridge.exe");
    await copyFile(executable, copied);
    await mkdir(join(installation, "bridge-runtime/scripts"), {recursive: true});
    for (const name of ["node.exe", "package.json", "scripts/local-bridge.mjs", "THIRD_PARTY_NOTICES.txt"]) {
      const bytes = await readFile(join(resources, name));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.files[name].sha256);
      assert.equal(bytes.length, manifest.files[name].bytes);
      await copyFile(join(resources, name), join(installation, "bridge-runtime", name));
    }
    await copyFile(join(resources, "runtime-manifest.json"), join(installation, "bridge-runtime/runtime-manifest.json"));
    function launch() {
      const token = randomBytes(16).toString("hex");
      const root = join(tmpdir(), "daybridge-package-validation-" + token);
      const fixture = {root, token};
      fixtures.push(fixture);
      child = spawn(copied, ["--validate-package", root, token], {cwd: installation, env: {SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(), PATH: "", LOCALAPPDATA: join(installation, "unused-parent-appdata")}, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
      exited = once(child, "exit");
      child.stderr.on("data", chunk => {nativeError = (nativeError + chunk).slice(-1500);});
      // Observe rejections immediately even while waiting for readiness.
      exited.catch(() => {});
      return fixture;
    }
    const fixture = launch();
    const first = await readEventually(join(fixture.root, "ready-1.json"), child);
    assert.equal(first.mode, "daybridge-package-validation-v1");
    assert.equal(first.runtimeSource, "Bundled");
    assert.equal(first.startupEnabled, false);
    assert.equal(first.keepAliveEnabled, false);
    let baseUrl = `http://127.0.0.1:${first.port}`;
    const health = await json(baseUrl, "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "daybridge");
    assert.match(health.body.bridgeVersion, /^0\.1\.0\+[a-f0-9]{12}$/);
    assert.equal(await realpath(health.body.sourceRoot), await realpath(join(installation, "bridge-runtime")));
    assert.equal(await realpath(health.body.dataDir), await realpath(join(fixture.root, "data")));
    assert.equal(health.body.handoffSinkDir, null);
    const created = await json(baseUrl, "/api/quests/manual", {method: "POST", headers: {"Content-Type": "application/json", "X-Request-Id": "package-validation-save"}, body: JSON.stringify({activityDate: "2099-01-02", title: "Package validation task"})});
    assert.equal(created.status, 201);
    assert.equal(created.body.saveState, "local_saved");
    const escape = await json(baseUrl, "/api/storage-location", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({dataDirectory: installation})});
    assert.equal(escape.status, 409);
    assert.equal(escape.body.code, "package_validation_restricted");
    const connect = await json(baseUrl, "/api/calendar/connect", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"});
    assert.equal(connect.status, 409);
    assert.equal(connect.body.code, "package_validation_restricted");
    const callback = await json(baseUrl, "/api/calendar/oauth/callback?code=fixture&state=fixture");
    assert.equal(callback.status, 409);
    assert.equal(callback.body.code, "package_validation_restricted");
    await writeFile(join(fixture.root, "restart-request"), "restart owned bridge");
    const second = await readEventually(join(fixture.root, "ready-2.json"), child);
    await stopped(first.bridgePid);
    baseUrl = `http://127.0.0.1:${second.port}`;
    const restarted = await json(baseUrl, "/api/health");
    assert.notEqual(restarted.body.instanceId, health.body.instanceId);
    const board = await json(baseUrl, "/api/board?date=2099-01-02");
    assert.equal(board.status, 200);
    assert.equal(board.body.board.quests.length, 1);
    assert.equal(board.body.board.quests[0].id, created.body.quest.id);
    await writeFile(join(fixture.root, "stop-request"), "stop owned bridge");
    const [code] = await exited;
    assert.equal(code, 0);
    const result = JSON.parse(await readFile(join(fixture.root, "validation-result.json"), "utf8"));
    assert.equal(result.reason, "requested");
    assert.equal(result.bridgeStopped, true);
    await stopped(second.bridgePid);
    const killedFixture = launch();
    const killedReady = await readEventually(join(killedFixture.root, "ready-1.json"), child);
    child.kill();
    await exited;
    await stopped(killedReady.bridgePid);
    assert.equal(startupValue() === originalStartup, true, "Windows startup registration changed during package validation");
    return {schemaVersion: 1, state: "verified", executableSha256: createHash("sha256").update(binary).digest("hex"), node: manifest.node, dependencyCount: manifest.dependencies.length, checks: {independentInstallation: true, emptyPath: true, healthIdentity: true, manualSave: true, restartPersistence: true, storageEscapeRejected: true, calendarAuthorizationDisabled: true, gracefulCleanup: true, killedParentCleanup: true, startupRegistrationUnchanged: true}, installerVerified: false};
  } catch (error) {
    const bridgeErrors = [];
    for (const fixture of fixtures) {
      const message = await readFile(join(fixture.root, "bridge-stderr.txt"), "utf8").catch(() => "");
      if (message) bridgeErrors.push(message.slice(-1500));
    }
    error.message += `; native: ${nativeError.trim() || "no diagnostic"}; bridge: ${bridgeErrors.join("; ") || "no diagnostic"}`;
    throw error;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {child.kill(); await exited;}
    for (const fixture of fixtures) {
      const owner = await readFile(join(fixture.root, "validation-owner.json"), "utf8").then(JSON.parse).catch(error => {if (error.code === "ENOENT") return null; throw error;});
      if (owner?.token === fixture.token) await rm(fixture.root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    }
    await rm(installation, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) throw new Error("Usage: node scripts/verify-package.mjs <validation-build-executable>");
  const receipt = await verifyPackage({executablePath: process.argv[2]});
  await mkdir("test-artifacts", {recursive: true});
  await writeFile("test-artifacts/package-execution.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}
