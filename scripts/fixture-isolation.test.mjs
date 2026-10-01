import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";

test("fixture ignores the parent's pointer and MARU profile and stops its listener", async () => {
  const parent = await mkdtemp(join(tmpdir(), "daybridge-parent-fixture-"));
  const originalAppData = process.env.LOCALAPPDATA;
  const originalProfile = process.env.MARU_ENV_PROFILE;
  let fixture;
  try {
    const protectedDir = join(parent, "protected");
    await mkdir(protectedDir);
    await writeFile(join(protectedDir, "sentinel.json"), '{"preserved":true}');
    await mkdir(join(parent, "Daybridge"));
    await mkdir(join(parent, "MARU"));
    await writeFile(join(parent, "Daybridge/storage-location.json"), JSON.stringify({ dataDirectory: protectedDir }));
    await writeFile(join(parent, "MARU/environment.json"), JSON.stringify({ maru_root: protectedDir }));
    process.env.LOCALAPPDATA = parent;
    process.env.MARU_ENV_PROFILE = join(parent, "MARU/environment.json");
    fixture = await startFixtureBridge();
    const health = await fixture.request("GET", "/api/health");
    assert.equal(health.body.dataDir, fixture.dataDir);
    assert.equal(health.body.handoffSinkDir, null);
    const created = await fixture.request("POST", "/api/quests/manual", { activityDate: "2099-01-02", title: "Fixture task" });
    assert.equal(created.status, 201);
    assert.equal(await readFile(join(protectedDir, "sentinel.json"), "utf8"), '{"preserved":true}');
    assert.deepEqual(await readdir(protectedDir), ["sentinel.json"]);
    const url = fixture.baseUrl;
    const dataDir = fixture.dataDir;
    await fixture.close();
    await assert.rejects(readFile(join(dataDir, "config.json")), { code: "ENOENT" });
    await assert.rejects(fetch(url + "/api/health", { signal: AbortSignal.timeout(1000) }));
    await fixture.close();
  } finally {
    if (fixture) await fixture.close();
    if (originalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalAppData;
    if (originalProfile === undefined) delete process.env.MARU_ENV_PROFILE;
    else process.env.MARU_ENV_PROFILE = originalProfile;
    await rm(parent, { recursive: true, force: true });
  }
});

test("fixtures have independent data and OS assigned ports", async () => {
  const first = await startFixtureBridge();
  const second = await startFixtureBridge();
  try {
    assert.notEqual(first.dataDir, second.dataDir);
    assert.notEqual(first.baseUrl, second.baseUrl);
    assert.equal((await second.request("GET", "/api/health")).body.dataDir, second.dataDir);
  } finally { await first.close(); await second.close(); }
});

test("fixture rejects escaping seed paths before launching", async () => {
  await assert.rejects(startFixtureBridge({ initialFiles: { "../escape.json": "{}" } }), /inside fixture/);
});
