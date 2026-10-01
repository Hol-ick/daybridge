import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export async function startFixtureBridge({ initialFiles = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "daybridge-fixture-"));
  const dataDir = join(root, "data");
  const appDataDir = join(root, "appdata");
  let child;
  let closed = false;
  async function close() {
    if (closed) return;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await Promise.race([exited, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("fixture bridge did not exit")), 5000);
        timer.unref();
      })]);
    }
    assert(inside(resolve(tmpdir()), root) && root.startsWith(join(tmpdir(), "daybridge-fixture-")));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    closed = true;
  }
  try {
    await mkdir(dataDir, { recursive: true });
    await mkdir(appDataDir, { recursive: true });
    for (const [name, content] of Object.entries(initialFiles)) {
      const path = resolve(dataDir, name);
      assert(inside(dataDir, path), "initialFiles must stay inside fixture data");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
    // Never discover a real handoff sink, even when the parent has a MARU profile.
    const config = JSON.parse(initialFiles["config.json"] || "{}");
    await writeFile(join(dataDir, "config.json"), JSON.stringify({ ...config, handoffSinkDir: null }));
    const env = { ...process.env, LOCALAPPDATA: appDataDir, DAYBRIDGE_DATA_DIR: dataDir, DAYBRIDGE_BRIDGE_PORT: "0" };
    delete env.MARU_ENV_PROFILE;
    child = spawn(process.execPath, [join(projectRoot, "scripts/local-bridge.mjs")], {
      cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"],
    });
    const baseUrl = await new Promise((resolveReady, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`fixture startup timeout: ${output}`)), 5000);
      const finish = (error, url) => {
        clearTimeout(timer);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        error ? reject(error) : resolveReady(url);
      };
      const onError = (error) => finish(error);
      const onExit = (code) => finish(new Error(`fixture exited (${code}): ${output}`));
      child.once("error", onError);
      child.once("exit", onExit);
      child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
      child.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-4000);
        const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(null, match[1]);
      });
    });
    async function request(method, path, body, { origin, contentType = "application/json", requestId } = {}) {
      assert(path.startsWith("/api/"), "fixture requests must use API paths");
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = contentType;
      if (origin !== undefined) headers.Origin = origin;
      if (requestId !== undefined) headers["X-Request-Id"] = requestId;
      const response = await fetch(baseUrl + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    }
    const health = await request("GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(resolve(health.body.dataDir), dataDir, "fixture selected an external data directory");
    assert.equal(health.body.handoffSinkDir, null, "fixture discovered an external handoff sink");
    return { baseUrl, dataDir, appDataDir, request, close };
  } catch (error) {
    await close();
    throw error;
  }
}
