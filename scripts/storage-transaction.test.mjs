import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadSchedule, reportScheduleBlock, saveSchedule } from "./schedule-store.mjs";
import { compile } from "./compile-quests.mjs";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withDateTransaction } from "./storage/date-transaction.mjs";
import { readJsonStrict } from "./storage/json-store.mjs";

const DATE = "2099-01-02";
async function worker(mode, root, extra = "", expectedCode = 0, env = {}) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./test-support/storage-worker.mjs", import.meta.url)), mode, root, DATE, extra], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Fixture worker timeout")); }, 15000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); code === expectedCode ? resolve() : reject(new Error(`Worker exited ${code}: ${output}`)); });
  });
  return output;
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "daybridge-storage-fixture-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
}

test("twenty simultaneous card reports all survive the read-modify-write boundary", async () => fixture(async (root) => {
  const blocks = Array.from({ length: 20 }, (_, i) => ({ id: `card-${i}`, questId: `q-${i}`, type: "focus", title: `Fixture ${i}`, status: "planned" }));
  await saveSchedule(root, DATE, { date: DATE, mode: "todo", blocks });
  const reports = await Promise.allSettled(blocks.map((block) => reportScheduleBlock(root, DATE, { blockId: block.id, status: "completed" })));
  assert.equal(reports.filter((r) => r.status === "fulfilled").length, 20);
  assert.equal((await loadSchedule(root, DATE)).blocks.filter((block) => block.status === "completed").length, 20);
}));

test("corrupt schedule JSON is an error and its original bytes remain intact", async () => fixture(async (root) => {
  await mkdir(join(root, "schedules"));
  const path = join(root, "schedules", `${DATE}.json`);
  await writeFile(path, '{"blocks":');
  await assert.rejects(loadSchedule(root, DATE), { code: "corrupt_json" });
  await assert.rejects(reportScheduleBlock(root, DATE, { blockId: "card-0", status: "completed" }), { code: "corrupt_json" });
  assert.equal(await readFile(path, "utf8"), '{"blocks":');
}));

test("compiler refuses a corrupt existing board rather than replacing state", async () => fixture(async (root) => {
  const output = join(root, "board.json");
  const plan = join(root, "plan.json");
  await writeFile(output, '{"quests":');
  await writeFile(plan, JSON.stringify({ artifact_type: "daybridge_quest_plan", quests: [] }));
  await assert.rejects(() => compile({ maruRoot: root, questPlan: plan, output, targetDate: DATE, sourceDate: DATE }), { code: "corrupt_json" });
  assert.equal(await readFile(output, "utf8"), '{"quests":');
}));

test("HTTP mutation exposes corrupt storage and preserves the damaged board", async () => {
  const f = await startFixtureBridge({ initialFiles: { [`boards/${DATE}.json`]: '{"quests":' } });
  try {
    const response = await f.request("POST", "/api/quests/manual", { activityDate: DATE, title: "Fixture task" });
    assert.equal(response.status, 500);
    assert.equal(response.body.code, "corrupt_json");
    assert.equal(await readFile(join(f.dataDir, "boards", `${DATE}.json`), "utf8"), '{"quests":');
  } finally { await f.close(); }
});

test("separate processes preserve all reports and shared board increments", async () => fixture(async (root) => {
  const ids = Array.from({ length: 20 }, (_, i) => `card-${i}`);
  await saveSchedule(root, DATE, { date: DATE, mode: "todo", blocks: ids.map((id) => ({ id, title: id, type: "focus", status: "planned" })) });
  await Promise.all([worker("reports", root, JSON.stringify(ids.slice(0, 10))), worker("reports", root, JSON.stringify(ids.slice(10)))]);
  assert.equal((await loadSchedule(root, DATE)).blocks.filter((block) => block.status === "completed").length, 20);
  await Promise.all([worker("increment", root, "10"), worker("increment", root, "10")]);
  assert.equal((await readJsonStrict(join(root, "boards", `${DATE}.json`))).counter, 20);
}));

test("a process killed after its first write is recovered by a new process before reading", async () => fixture(async (root) => {
  await saveSchedule(root, DATE, { date: DATE, mode: "todo", blocks: [], marker: "original" });
  await worker("crash", root, "", 23);
  const journalPath = join(root, ".transactions", `${DATE}.journal.json`);
  const prepared = await readJsonStrict(journalPath);
  assert.equal(prepared.state, "prepared");
  assert.equal((await readJsonStrict(join(root, "schedules", `${DATE}.json`))).marker, "original");
  const recovered = JSON.parse(await worker("read", root));
  assert.equal(recovered.marker, "recovered");
  const settled = await readJsonStrict(journalPath);
  assert.equal(settled.state, "settled");
  assert.equal(settled.transactionId, prepared.transactionId);
  assert.equal((await readJsonStrict(join(root, "boards", `${DATE}.json`))).marker, "recovered");
  assert.equal((await loadSchedule(root, DATE)).marker, "recovered");
}));

test("a middle write failure keeps its journal and no reader exposes the partial state", async () => fixture(async (root) => {
  const blocked = join(root, "state", "second.json");
  await assert.rejects(withDateTransaction({ dataDir: root, date: DATE, onCommitStep: async ({ index }) => {
    if (index === 0) await mkdir(blocked);
  } }, async () => ({ writes: [
    { path: "state/first.json", value: { marker: "final" } },
    { path: "state/second.json", value: { marker: "final" } },
  ] })), { code: "storage_write_failed" });
  const journal = await readJsonStrict(join(root, ".transactions", `${DATE}.journal.json`));
  assert.equal(journal.state, "prepared");
  await assert.rejects(loadSchedule(root, DATE), { code: "storage_read_failed" });
  await rm(blocked, { recursive: true });
  await worker("read", root);
  assert.deepEqual(await readJsonStrict(join(root, "state", "first.json")), { marker: "final" });
  assert.deepEqual(await readJsonStrict(join(root, "state", "second.json")), { marker: "final" });
  assert.equal((await readJsonStrict(join(root, ".transactions", `${DATE}.journal.json`))).state, "settled");
}));

test("live and unknown lock owners are preserved and produce a bounded conflict", async () => fixture(async (root) => {
  await mkdir(join(root, ".transactions"));
  const path = join(root, ".transactions", "store.lock");
  for (const contents of [JSON.stringify({ pid: process.pid, token: "fixture-live-owner" }), "unknown lock owner"]) {
    await writeFile(path, contents);
    const started = Date.now();
    await assert.rejects(loadSchedule(root, DATE), { code: "storage_conflict", status: 409 });
    assert(Date.now() - started < 4000);
    assert.equal(await readFile(path, "utf8"), contents);
  }
}));

test("damaged and escaping journals are preserved without recovery writes", async () => fixture(async (root) => {
  await mkdir(join(root, ".transactions"));
  const path = join(root, ".transactions", `${DATE}.journal.json`);
  for (const contents of ['{"writes":', JSON.stringify({ schemaVersion: 1, transactionId: "fixture", date: DATE, state: "prepared", writes: [{ path: "../escape.json", value: {} }] })]) {
    await writeFile(path, contents);
    await assert.rejects(loadSchedule(root, DATE), { code: "storage_recovery_failed" });
    assert.equal(await readFile(path, "utf8"), contents);
  }
}));

test("HTTP concurrent reports commit both board and schedule before success", async () => {
  const quests = Array.from({ length: 20 }, (_, i) => ({ id: `q-${i}`, title: `Fixture ${i}`, state: "ready", status: "ready", estimateMinutes: 50, remainingMinutes: 50, steps: [{ id: `s-${i}`, label: "Fixture action", completed: false }], progress: { completed: 0, total: 1 } }));
  const schedule = { date: DATE, generatedAt: `${DATE}T09:00:00+09:00`, mode: "todo", timeConfigured: false, blocks: quests.map((quest, i) => ({ id: `card-${i}`, questId: quest.id, type: "focus", title: quest.title, status: "planned" })) };
  const f = await startFixtureBridge({ initialFiles: {
    [`boards/${DATE}.json`]: JSON.stringify({ schemaVersion: 2, activityDate: DATE, quests, sourceWarnings: [] }),
    [`schedules/${DATE}.json`]: JSON.stringify(schedule),
  } });
  try {
    const responses = await Promise.all(quests.map((_, i) => f.request("POST", "/api/schedule/block-report", { activityDate: DATE, blockId: `card-${i}`, status: "completed" })));
    assert(responses.every((response) => response.status === 200), JSON.stringify(responses.map(({ status, body }) => ({ status, body }))));
    const board = await readJsonStrict(join(f.dataDir, "boards", `${DATE}.json`));
    const saved = await readJsonStrict(join(f.dataDir, "schedules", `${DATE}.json`));
    assert.equal(board.quests.filter((quest) => quest.state === "completed").length, 20);
    assert.equal(saved.blocks.filter((block) => block.status === "completed").length, 20);
    assert.deepEqual(await readJsonStrict(join(f.dataDir, "boards", "latest.json")), board);
  } finally { await f.close(); }
});

test("compiler and bridge share the lock and preserve user reports and manual tasks", async () => {
  const plan = { artifact_type: "daybridge_quest_plan", source: { quality: "aligned" }, quests: [{ id: "q-source", title: "Check fixture", actor: "user", kind: "review", execution: "independent", steps: [{ id: "s-open", label: "Open fixture" }] }] };
  const f = await startFixtureBridge({ initialFiles: { "plan.json": JSON.stringify(plan) } });
  try {
    await worker("compile", f.dataDir, "1");
    const manual = await f.request("POST", "/api/quests/manual", { activityDate: DATE, title: "Preserved manual fixture" });
    assert.equal(manual.status, 201);
    const [responses] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => f.request("POST", "/api/report", { activityDate: DATE, questId: "q-source", status: "completed", steps: [{ id: "s-open", completed: true }] }))),
      worker("compile", f.dataDir, "10"),
    ]);
    assert(responses.every((response) => response.status === 200));
    const board = await readJsonStrict(join(f.dataDir, "boards", `${DATE}.json`));
    assert.equal(board.quests.find((quest) => quest.id === "q-source").reports.length, 10);
    assert.equal(board.quests.find((quest) => quest.id === "q-source").state, "completed");
    assert(board.quests.some((quest) => quest.id === manual.body.quest.id));
    assert.deepEqual(await readJsonStrict(join(f.dataDir, "boards", "latest.json")), board);
  } finally { await f.close(); }
});

test("valid JSON with damaged schedule or board shape is preserved", async () => fixture(async (root) => {
  await mkdir(join(root, "schedules"));
  const schedulePath = join(root, "schedules", `${DATE}.json`);
  const contents = JSON.stringify({ date: DATE, blocks: "damaged" });
  await writeFile(schedulePath, contents);
  await assert.rejects(loadSchedule(root, DATE), { code: "invalid_record" });
  assert.equal(await readFile(schedulePath, "utf8"), contents);
  const boardPath = join(root, "board.json");
  const planPath = join(root, "plan.json");
  await writeFile(boardPath, '{"quests":"damaged"}');
  await writeFile(planPath, '{"artifact_type":"daybridge_quest_plan","quests":[]}');
  await assert.rejects(compile({ maruRoot: root, questPlan: planPath, output: boardPath, sourceDate: DATE, targetDate: DATE }), { code: "invalid_record" });
  assert.equal(await readFile(boardPath, "utf8"), '{"quests":"damaged"}');
}));

test("a junction cannot send transaction writes outside the selected data root", async () => fixture(async (root) => {
  const dataDir = join(root, "data");
  const outside = join(root, "protected");
  await mkdir(dataDir);
  await mkdir(outside);
  const sentinel = join(outside, "sentinel.json");
  await writeFile(sentinel, '{"preserved":true}');
  await symlink(outside, join(dataDir, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(withDateTransaction({ dataDir, date: DATE }, async () => ({ writes: [
    { path: "linked/sentinel.json", value: { changed: true } },
  ] })), { code: "invalid_journal" });
  assert.equal(await readFile(sentinel, "utf8"), '{"preserved":true}');
}));

test("compiler default output respects the persisted pointer before the environment fallback", async () => {
  const f = await startFixtureBridge({ initialFiles: { "plan.json": '{"artifact_type":"daybridge_quest_plan","quests":[]}' } });
  try {
    await mkdir(join(f.appDataDir, "Daybridge"));
    await writeFile(join(f.appDataDir, "Daybridge", "storage-location.json"), JSON.stringify({ dataDirectory: f.dataDir }));
    const wrong = join(f.dataDir, "wrong-fallback");
    await worker("compile-default", f.dataDir, "1", 0, { LOCALAPPDATA: f.appDataDir, DAYBRIDGE_DATA_DIR: wrong });
    const board = await readJsonStrict(join(f.dataDir, "boards", `${DATE}.json`));
    assert.equal(board.activityDate, DATE);
    assert.deepEqual(await readJsonStrict(join(f.dataDir, "boards", "latest.json")), board);
    assert.equal(await readJsonStrict(join(wrong, "boards", `${DATE}.json`)), null);
  } finally { await f.close(); }
});
