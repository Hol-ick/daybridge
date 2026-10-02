import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from "node:fs/promises";
import {renameRuntime} from "./rename-runtime.mjs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {once} from "node:events";
import {createHash} from "node:crypto";
import {prepareBridgeRuntime, prepareTauriBridgeRuntime} from "./package-bridge.mjs";

test("an independent bridge runtime includes its interpreter, dependencies and inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "daybridge-package-"));
  let child;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    let timer;
    try {await Promise.race([exited, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error("packaged fixture did not exit")), 5000);})]);}
    finally {clearTimeout(timer);}
  }
  try {
    const runtime = join(root, "runtime");
    const manifest = await prepareBridgeRuntime({nodeExecutable: process.execPath, outputDir: runtime});
    assert.equal(manifest.node.version, "v24.19.0");
    assert.equal(manifest.node.platform, "win32");
    assert.equal(manifest.node.arch, "x64");
    assert(manifest.dependencies.some(item => item.name === "googleapis" && item.version === "170.0.0"));
    assert.deepEqual(Object.keys(manifest.files).sort(), ["node.exe", "package.json", "scripts/local-bridge.mjs", "THIRD_PARTY_NOTICES.txt"].sort());
    const bundle = await readFile(join(runtime, "scripts/local-bridge.mjs"), "utf8");
    assert(!bundle.includes(process.cwd()));
    assert(!bundle.includes(process.cwd().replaceAll("\\", "/")));
    assert(!bundle.includes(JSON.stringify(process.cwd()).slice(1, -1)));
    assert(!bundle.includes('from "googleapis"'));
    const version = spawnSync(join(runtime, "node.exe"), ["--version"], {cwd: root, env: {SystemRoot: process.env.SystemRoot, PATH: ""}, encoding: "utf8"});
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), "v24.19.0");
    for (const [name, item] of Object.entries(manifest.files)) {
      const bytes = await readFile(join(runtime, name));
      assert.equal(bytes.length, item.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
    }
    const dataDir = join(root, "data");
    await mkdir(dataDir);
    await writeFile(join(dataDir, "config.json"), '{"handoffSinkDir":null}');
    const env = {SystemRoot: process.env.SystemRoot, PATH: "", LOCALAPPDATA: join(root, "appdata"), DAYBRIDGE_DATA_DIR: dataDir, MARU_ENV_PROFILE: join(root, "missing-profile.json"), DAYBRIDGE_BRIDGE_PORT: "0"};
    async function launch() {
      child = spawn(join(runtime, "node.exe"), [join(runtime, "scripts/local-bridge.mjs")], {cwd: root, env, stdio: ["ignore", "pipe", "pipe"]});
      return await new Promise((resolveReady, reject) => {
        let output = "";
        const finish = (error, url) => {
          clearTimeout(timer);
          child.removeListener("error", onError);
          child.removeListener("exit", onExit);
          error ? reject(error) : resolveReady(url);
        };
        const onError = error => finish(error);
        const onExit = code => finish(new Error(`packaged bridge exited (${code}): ${output}`));
        const timer = setTimeout(() => finish(new Error(`packaged bridge startup timeout: ${output}`)), 10000);
        child.once("error", onError);
        child.once("exit", onExit);
        child.stderr.on("data", chunk => {output = (output + chunk).slice(-4000);});
        child.stdout.on("data", chunk => {
          output = (output + chunk).slice(-4000);
          const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
          if (match) finish(null, match[1]);
        });
      });
    }
    async function json(url, options) {
      const response = await fetch(url, {...options, signal: AbortSignal.timeout(5000)});
      return {status: response.status, body: await response.json()};
    }
    let baseUrl = await launch();
    const health = await json(baseUrl + "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.service, "daybridge");
    assert.equal(health.body.sourceRoot, runtime);
    assert.equal(health.body.dataDir, dataDir);
    assert.equal(health.body.handoffSinkDir, null);
    assert.match(health.body.bridgeVersion, /^0\.1\.0\+[a-f0-9]{12}$/);
    const created = await json(baseUrl + "/api/quests/manual", {method: "POST", headers: {"Content-Type": "application/json", "X-Request-Id": "packaged-fixture-save"}, body: JSON.stringify({activityDate: "2099-01-02", title: "Packaged fixture", durationMinutes: 50})});
    assert.equal(created.status, 201);
    const persisted = JSON.parse(await readFile(join(dataDir, "boards/2099-01-02.json"), "utf8"));
    assert.equal(persisted.quests[0].id, created.body.quest.id);
    await stop();
    baseUrl = await launch();
    const restarted = await json(baseUrl + "/api/health");
    assert.notEqual(restarted.body.instanceId, health.body.instanceId);
    const board = await json(baseUrl + "/api/board?date=2099-01-02");
    assert.equal(board.status, 200);
    assert.equal(board.body.board.quests.length, 1);
    assert.equal(board.body.board.quests[0].id, created.body.quest.id);
    await assert.rejects(prepareBridgeRuntime({nodeExecutable: process.execPath, outputDir: runtime}), /already exists/);
    await stop();
    const resourceDirectory = join(root, "resources");
    await mkdir(resourceDirectory);
    const published = join(resourceDirectory, "bridge-runtime");
    await renameRuntime(runtime, published);
    await prepareTauriBridgeRuntime({nodeExecutable: process.execPath, resourceDirectory});
    assert.equal(JSON.parse(await readFile(join(published, "runtime-manifest.json"), "utf8")).schemaVersion, 1);
    await writeFile(join(published, "private-note.txt"), "preserve unknown content");
    await assert.rejects(prepareTauriBridgeRuntime({nodeExecutable: process.execPath, resourceDirectory}), /unmanaged files/);
    assert.equal(await readFile(join(published, "private-note.txt"), "utf8"), "preserve unknown content");
    await rm(join(published, "private-note.txt"));
    await writeFile(join(published, "scripts/local-bridge.mjs"), "preserve damaged artifact");
    await assert.rejects(prepareTauriBridgeRuntime({nodeExecutable: process.execPath, resourceDirectory}), /checksum mismatch/);
    assert.equal(await readFile(join(published, "scripts/local-bridge.mjs"), "utf8"), "preserve damaged artifact");
  } finally {await stop(); await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});}
});

test("copying only the existing bridge entry cannot run without the checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "daybridge-unbundled-"));
  try {
    await mkdir(join(root, "scripts"));
    await copyFile(new URL("./local-bridge.mjs", import.meta.url), join(root, "scripts/local-bridge.mjs"));
    await writeFile(join(root, "package.json"), '{"version":"0.1.0","type":"module"}');
    const result = spawnSync(process.execPath, [join(root, "scripts/local-bridge.mjs")], {
      cwd: root, env: {...process.env, LOCALAPPDATA: root, DAYBRIDGE_DATA_DIR: join(root, "data"), MARU_ENV_PROFILE: join(root, "missing-profile.json"), DAYBRIDGE_BRIDGE_PORT: "0"}, encoding: "utf8", timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {await rm(root, {recursive: true, force: true});}
});
