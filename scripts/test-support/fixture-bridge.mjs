import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  let baseUrl;
  let closed = false;
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      let timer;
      try { await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("fixture bridge did not exit")), 5000);
      })]); } finally { clearTimeout(timer); }
    }
  }
  async function close() {
    if (closed) return;
    await stop();
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
    async function launch() {
    child = spawn(process.execPath, [join(projectRoot, "scripts/local-bridge.mjs")], {
      cwd: projectRoot, env, stdio: ["ignore", "pipe", "pipe"],
    });
    baseUrl = await new Promise((resolveReady, reject) => {
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
    }
    await launch();
    async function request(method, path, body, { origin, contentType = "application/json", requestId, timeoutMs = 5000 } = {}) {
      assert(path.startsWith("/api/"), "fixture requests must use API paths");
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = contentType;
      if (origin !== undefined) headers.Origin = origin;
      if (requestId !== undefined) headers["X-Request-Id"] = requestId;
      const response = await fetch(baseUrl + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    }
    const health = await request("GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(resolve(health.body.dataDir), dataDir, "fixture selected an external data directory");
    assert.equal(health.body.handoffSinkDir, null, "fixture discovered an external handoff sink");
    async function restart() {
      assert(!closed, "cannot restart a closed fixture");
      const configured = JSON.parse(await readFile(join(dataDir, "config.json"), "utf8"));
      assert(!configured.handoffSinkDir || inside(root, resolve(configured.handoffSinkDir)), "restart sink must stay inside fixture");
      if (configured.handoffSinkDir) {
        const target = resolve(configured.handoffSinkDir);
        let ancestor = target;
        while (true) {
          try {
            const physical = resolve(await realpath(ancestor), relative(ancestor, target));
            assert(inside(await realpath(root), physical), "restart sink link escapes fixture");
            break;
          } catch (error) {
            if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor) throw error;
            ancestor = parent;
          }
        }
      }
      try {
        const pointer = JSON.parse(await readFile(join(appDataDir, "Daybridge", "storage-location.json"), "utf8"));
        assert.equal(resolve(pointer.dataDirectory), dataDir, "restart pointer must use fixture data");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      await stop();
      try {
        await launch();
        const health = await request("GET", "/api/health");
        assert.equal(resolve(health.body.dataDir), dataDir);
      } catch (error) { await close(); throw error; }
    }
    return { get baseUrl() { return baseUrl; }, get processId() { return child.pid; }, dataDir, appDataDir, request, restart, close };
  } catch (error) {
    await close();
    throw error;
  }
}
