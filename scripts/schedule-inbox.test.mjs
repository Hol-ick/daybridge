import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const DATE = "2099-02-03";
const DIRECT_DATE = "2099-02-04";

async function startBridge(dataDir) {
  const port = 40400 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ["scripts/local-bridge.mjs"], {
    cwd: process.cwd(), env: { ...process.env, DAYBRIDGE_BRIDGE_PORT: String(port), DAYBRIDGE_DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge did not start: ${output.join("")}`)), 5000);
    child.stdout.on("data", (chunk) => { output.push(chunk.toString()); if (output.join("").includes("listening")) { clearTimeout(timer); resolve(); } });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { if (code !== 0) { clearTimeout(timer); reject(new Error(`bridge exited (${code}): ${output.join("")}`)); } });
  });
  return { child, baseUrl: `http://127.0.0.1:${port}` };
}

function inbox(title = "리눅스 학습", date = DATE) {
  return `---
artifact_type: daybridge_schedule_inbox
schema_version: "1"
schedule_date: ${date}
timezone: Asia/Seoul
updated_at: ${date}T09:00:00+09:00
---

| id | title | focus_units | remaining_units | state | priority | execution | depends_on | first_action | done_when | source_refs |
|---|---|---:|---:|---|---|---|---|---|---|---|
| inbox-task | ${title} | 1 | 1 | ready | must | independent |  | 실습 시작 | 결과 기록 | record://session/${date} |
`;
}

test("local bridge ingests a changed date inbox and exposes validation details", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-schedule-inbox-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    await mkdir(join(dataDir, "boards"), { recursive: true });
    await writeFile(join(dataDir, "boards", `${DATE}.json`), JSON.stringify({
      schemaVersion: 2, activityDate: DATE, sourceWarnings: [], quests: [],
    }));
    const inboxPath = join(dataDir, "inbox", `schedule-${DATE}.md`);
    await mkdir(join(dataDir, "inbox"), { recursive: true });
    await writeFile(inboxPath, inbox(), "utf8");

    const first = await fetch(`${baseUrl}/api/schedule?date=${DATE}`);
    assert.equal(first.status, 200);
    const initial = await first.json();
    assert.equal(initial.schedule.inbox.valid, true);
    assert.equal(initial.schedule.inbox.accepted, 1);
    assert.equal(initial.schedule.blocks.find((block) => block.type === "focus")?.title, "리눅스 학습");

    await writeFile(inboxPath, inbox("옛 KTH 경로 확인"), "utf8");
    const detail = await fetch(`${baseUrl}/api/schedule/inbox?date=${DATE}`);
    const detailBody = await detail.json();
    assert.equal(detailBody.valid, true);
    assert.equal(detailBody.tasks[0].title, "옛 KTH 경로 확인");
    const changed = await fetch(`${baseUrl}/api/schedule?date=${DATE}`);
    const changedBody = await changed.json();
    assert.equal(changedBody.schedule.blocks.find((block) => block.type === "focus")?.title, "옛 KTH 경로 확인");

    const saved = JSON.parse(await readFile(join(dataDir, "schedules", `${DATE}.json`), "utf8"));
    assert.equal(typeof saved.inbox.fingerprint, "string");
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("a direct session inbox builds a schedule without a closeout board", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-direct-inbox-"));
  const { child, baseUrl } = await startBridge(dataDir);
  try {
    const inboxPath = join(dataDir, "inbox", `schedule-${DIRECT_DATE}.md`);
    await mkdir(join(dataDir, "inbox"), { recursive: true });
    await writeFile(inboxPath, inbox("현재 세션 작업", DIRECT_DATE), "utf8");

    const scheduleResponse = await fetch(`${baseUrl}/api/schedule?date=${DIRECT_DATE}`);
    assert.equal(scheduleResponse.status, 200);
    const scheduleBody = await scheduleResponse.json();
    assert.equal(scheduleBody.schedule.inbox.accepted, 1);
    assert.equal(scheduleBody.schedule.blocks.find((block) => block.type === "focus")?.title, "현재 세션 작업");

    const boardResponse = await fetch(`${baseUrl}/api/board?date=${DIRECT_DATE}`);
    assert.equal(boardResponse.status, 200);
    const boardBody = await boardResponse.json();
    assert.equal(boardBody.board.quests[0].sourceKind, "session");
    assert.equal(boardBody.board.quests[0].title, "현재 세션 작업");
  } finally {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  }
});
