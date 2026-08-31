import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const DATE = "2099-01-02";

async function startBridge(dataDir) {
  const port = 39400 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ["scripts/local-bridge.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DAYBRIDGE_BRIDGE_PORT: String(port), DAYBRIDGE_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge did not start: ${output.join("")}`)), 5_000);
    child.stdout.on("data", (chunk) => {
      output.push(chunk.toString());
      if (output.join("").includes("listening")) { clearTimeout(timer); resolve(); }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      if (code !== 0) { clearTimeout(timer); reject(new Error(`bridge exited (${code}): ${output.join("")}`)); }
    });
  });
  await ready;
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

async function createBoard(dataDir) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const boards = join(dataDir, "boards");
  await mkdir(boards, { recursive: true });
  await writeFile(join(dataDir, "config.json"), JSON.stringify({ handoffSinkDir: null }));
  await writeFile(join(dataDir, "schedule-settings.json"), JSON.stringify({ dayStart: "09:00", dayEnd: "18:00", timeConfigured: true, bufferMinutes: 10 }));
  await writeFile(join(boards, `${DATE}.json`), JSON.stringify({ schemaVersion: 2, activityDate: DATE, quests: [], sourceWarnings: [] }));
}

test("manual task endpoint saves a task and splits it into 50-minute blocks", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-manual-task-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    const settingsResponse = await fetch(`${baseUrl}/api/schedule-settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityDate: DATE, dayStart: "09:00", dayEnd: "18:00", timeConfigured: true, bufferMinutes: 10 }),
    });
    assert.equal(settingsResponse.status, 200);
    const response = await fetch(`${baseUrl}/api/quests/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://tauri.localhost" },
      body: JSON.stringify({ activityDate: DATE, title: "리눅스 학습", durationMinutes: 100 }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://tauri.localhost");
    const result = await response.json();
    assert.equal(result.quest.title, "리눅스 학습");
    assert.equal(result.quest.sourceLabel, "수동 추가");
    assert.equal(result.quest.sourcePath, "manual://widget");
    assert.equal(result.quest.estimateMinutes, 100);
    const focus = result.schedule.blocks.filter((block) => block.type === "focus" && block.questId === result.quest.id);
    assert.deepEqual(focus.map((block) => [block.startAt.slice(11, 16), block.endAt.slice(11, 16)]), [["09:00", "09:50"], ["10:00", "10:50"]]);
    const saved = JSON.parse(await readFile(join(dataDir, "boards", `${DATE}.json`), "utf8"));
    assert.equal(saved.quests.length, 1);
    const activityResponse = await fetch(`${baseUrl}/api/activity?date=${DATE}`);
    assert.equal(activityResponse.status, 200);
    const activity = await activityResponse.json();
    assert.ok(activity.records.some((record) => record.action === "schedule_settings_changed"));
    assert.equal(activity.records.at(-1).action, "task_added");
    assert.equal(activity.records.at(-1).subject.title, "리눅스 학습");
    const activityMarkdown = await readFile(join(dataDir, "activity", `${DATE}.md`), "utf8");
    assert.match(activityMarkdown, /작업 추가/);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("manual task endpoint rejects non-unit durations and blank titles", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-manual-task-invalid-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    for (const body of [
      { activityDate: DATE, title: "", durationMinutes: 50 },
      { activityDate: DATE, title: "리눅스 학습", durationMinutes: 75 },
    ]) {
      const response = await fetch(`${baseUrl}/api/quests/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});
