import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const DATE = "2099-01-03";

async function startBridge(dataDir) {
  const port = 39900 + Math.floor(Math.random() * 500);
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
  await mkdir(join(dataDir, "boards"), { recursive: true });
  await writeFile(join(dataDir, "config.json"), JSON.stringify({ handoffSinkDir: null }));
  await writeFile(join(dataDir, "schedule-settings.json"), JSON.stringify({ dayStart: "09:00", dayEnd: "18:00", timeConfigured: true, bufferMinutes: 10 }));
  const quests = ["GitHub Actions에서 Verify web-buyback 배포 상태와 첫 실패 로그 확인", "리눅스 학습", "내일 계획"].map((title, index) => ({
    id: `quest-${index + 1}`,
    title,
    scheduleTitle: title,
    displayTitle: title,
    priority: "must",
    state: "ready",
    status: "ready",
    execution: "independent",
    dependsOn: [],
    estimateMinutes: 50,
    remainingMinutes: 50,
    sourceKind: "briefing",
  }));
  await writeFile(join(dataDir, "boards", `${DATE}.json`), JSON.stringify({ schemaVersion: 2, activityDate: DATE, quests, sourceWarnings: [] }));
}

test("schedule block move reorders open focus cards without entering lunch", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-schedule-move-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    const rebuilt = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    assert.equal(rebuilt.status, 200);
    const initial = await rebuilt.json();
    const initialFocus = initial.schedule.blocks.filter((block) => block.type === "focus");
    assert.deepEqual(initialFocus.map((block) => block.startAt.slice(11, 16)), ["09:00", "10:00", "13:00"]);
    assert.equal(initialFocus[0].title, "배포 상태 확인");

    const movedResponse = await fetch(`${baseUrl}/api/schedule/block-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://tauri.localhost" },
      body: JSON.stringify({ activityDate: DATE, blockId: initialFocus[0].id, targetBlockId: initialFocus[2].id, position: "after" }),
    });
    assert.equal(movedResponse.status, 200);
    const moved = await movedResponse.json();
    const movedFocus = moved.schedule.blocks.filter((block) => block.type === "focus").sort((left, right) => left.startAt.localeCompare(right.startAt));
    assert.deepEqual(movedFocus.map((block) => [block.questId, block.startAt.slice(11, 16)]), [["quest-2", "09:00"], ["quest-3", "10:00"], ["quest-1", "13:00"]]);
    assert.equal(movedFocus.every((block) => block.locked && block.userPositioned), true);
    assert.equal(moved.schedule.blocks.some((block) => block.type === "focus" && ["11:00", "12:00"].includes(block.startAt.slice(11, 16))), false);
    assert.equal(movedResponse.headers.get("access-control-allow-origin"), "http://tauri.localhost");
    const saved = JSON.parse(await readFile(join(dataDir, "schedules", `${DATE}.json`), "utf8"));
    assert.equal(saved.blocks.filter((block) => block.type === "focus").find((block) => block.questId === "quest-1").startAt.slice(11, 16), "13:00");
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("schedule block move rejects completed cards and lunch-only targets", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-schedule-move-invalid-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    const rebuilt = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    const initial = await rebuilt.json();
    const first = initial.schedule.blocks.find((block) => block.type === "focus");
    const completedSchedule = { ...initial.schedule, blocks: initial.schedule.blocks.map((block) => block.id === first.id ? { ...block, status: "completed" } : block) };
    await writeFile(join(dataDir, "schedules", `${DATE}.json`), JSON.stringify(completedSchedule));
    const response = await fetch(`${baseUrl}/api/schedule/block-move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE, blockId: first.id, targetBlockId: "lunch-2099-01-03-1", position: "before" }) });
    assert.equal(response.status, 400);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("schedule block discard removes the card and keeps its quest unit out after rebuild", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-schedule-discard-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    const rebuilt = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    const initial = await rebuilt.json();
    const source = initial.schedule.blocks.find((block) => block.type === "focus");
    const discardedResponse = await fetch(`${baseUrl}/api/schedule/block-discard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://tauri.localhost" },
      body: JSON.stringify({ activityDate: DATE, blockId: source.id }),
    });
    assert.equal(discardedResponse.status, 200);
    const discarded = await discardedResponse.json();
    assert.equal(discarded.schedule.blocks.some((block) => block.id === source.id), false);
    assert.deepEqual(discarded.schedule.discardedBlocks.map((item) => item.questId), [source.questId]);
    assert.equal(discardedResponse.headers.get("access-control-allow-origin"), "http://tauri.localhost");

    const rebuiltAgain = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    assert.equal(rebuiltAgain.status, 200);
    const rebuiltResult = await rebuiltAgain.json();
    assert.equal(rebuiltResult.schedule.blocks.some((block) => block.questId === source.questId), false);
    assert.deepEqual(rebuiltResult.schedule.discardedBlocks.map((item) => item.questId), [source.questId]);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});
