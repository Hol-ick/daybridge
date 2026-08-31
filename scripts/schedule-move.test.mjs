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

test("schedule block completion persists to the quest and survives adding another task", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-schedule-status-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    await mkdir(join(dataDir, "inbox"), { recursive: true });
    await writeFile(join(dataDir, "inbox", `schedule-${DATE}.md`), [
      "---",
      "artifact_type: daybridge_schedule_inbox",
      `activity_date: ${DATE}`,
      "timezone: Asia/Seoul",
      "---",
      "",
      "| id | title | focus_units | remaining_units | state | priority | execution | depends_on | first_action | done_when | source_refs |",
      "| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
      "| quest-1 | 배포 상태 확인 | 1 | 1 | ready | must | independent |  | 시작 | 결과 기록 | record://test |",
      "",
    ].join("\n"), "utf8");
    const rebuilt = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    assert.equal(rebuilt.status, 200);
    const initial = await rebuilt.json();
    const source = initial.schedule.blocks.find((block) => block.type === "focus" && block.questId === "quest-1");
    assert.ok(source);

    const completedResponse = await fetch(`${baseUrl}/api/schedule/block-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityDate: DATE, blockId: source.id, status: "completed", note: "완료" }),
    });
    assert.equal(completedResponse.status, 200);
    const completed = await completedResponse.json();
    assert.equal(completed.schedule.blocks.find((block) => block.id === source.id).status, "completed");
    const boardAfterReport = JSON.parse(await readFile(join(dataDir, "boards", `${DATE}.json`), "utf8"));
    assert.equal(boardAfterReport.quests.find((quest) => quest.id === source.questId).state, "completed");

    const addedResponse = await fetch(`${baseUrl}/api/quests/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityDate: DATE, title: "새 작업", durationMinutes: 50 }),
    });
    assert.equal(addedResponse.status, 201);
    const added = await addedResponse.json();
    const preserved = added.schedule.blocks.filter((block) => block.type === "focus" && block.questId === source.questId);
    assert.ok(preserved.length >= 1);
    assert.ok(preserved.every((block) => block.status === "completed"), preserved);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("untimed todo completion remains completed after adding another task", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-todo-status-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    await writeFile(join(dataDir, "schedule-settings.json"), JSON.stringify({ dayStart: "", dayEnd: "", timeConfigured: false, bufferMinutes: 10 }));
    const rebuilt = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    assert.equal(rebuilt.status, 200);
    const initial = await rebuilt.json();
    const source = initial.schedule.blocks.find((block) => block.type === "focus");
    assert.ok(source);
    assert.equal(initial.schedule.mode, "todo");

    const completedResponse = await fetch(`${baseUrl}/api/schedule/block-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityDate: DATE, blockId: source.id, status: "completed", note: "완료" }),
    });
    assert.equal(completedResponse.status, 200);
    const completed = await completedResponse.json();
    assert.equal(completed.schedule.blocks.find((block) => block.id === source.id).status, "completed");

    const addedResponse = await fetch(`${baseUrl}/api/quests/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityDate: DATE, title: "todo 새 작업", durationMinutes: 50 }),
    });
    assert.equal(addedResponse.status, 201);
    const added = await addedResponse.json();
    const preserved = added.schedule.blocks.find((block) => block.id === source.id);
    assert.ok(preserved);
    assert.equal(preserved.status, "completed");
    assert.ok(added.schedule.blocks.some((block) => block.title === "todo 새 작업"));
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("untimed todo move changes card order without assigning times", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-todo-move-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await createBoard(dataDir);
    await writeFile(join(dataDir, "schedule-settings.json"), JSON.stringify({ dayStart: "", dayEnd: "", timeConfigured: false, bufferMinutes: 10 }));
    const rebuilt = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    assert.equal(rebuilt.status, 200);
    const initial = await rebuilt.json();
    const focus = initial.schedule.blocks.filter((block) => block.type === "focus");
    assert.equal(focus.length, 3);
    const source = focus[0];
    const target = focus[1];

    const movedResponse = await fetch(`${baseUrl}/api/schedule/block-move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityDate: DATE, blockId: source.id, targetBlockId: target.id, position: "after" }),
    });
    assert.equal(movedResponse.status, 200);
    const moved = await movedResponse.json();
    const movedFocus = moved.schedule.blocks.filter((block) => block.type === "focus").sort((left, right) => left.order - right.order);
    assert.deepEqual(movedFocus.map((block) => block.id), [target.id, source.id, focus[2].id]);
    assert.ok(movedFocus.every((block) => block.timed === false && !block.startAt && !block.endAt));
    assert.ok(movedFocus.every((block) => block.userPositioned === true));

    const rebuiltAgain = await fetch(`${baseUrl}/api/schedule/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE }) });
    assert.equal(rebuiltAgain.status, 200);
    const afterRebuild = await rebuiltAgain.json();
    const stableFocus = afterRebuild.schedule.blocks.filter((block) => block.type === "focus").sort((left, right) => left.order - right.order);
    assert.deepEqual(stableFocus.map((block) => block.id), [target.id, source.id, focus[2].id]);
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});
