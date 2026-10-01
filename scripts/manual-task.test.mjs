import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startFixtureBridge } from "./test-support/fixture-bridge.mjs";
import test from "node:test";

const DATE = "2099-01-02";


async function createBoard(dataDir) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const boards = join(dataDir, "boards");
  await mkdir(boards, { recursive: true });
  await writeFile(join(dataDir, "config.json"), JSON.stringify({ handoffSinkDir: null }));
  await writeFile(join(dataDir, "schedule-settings.json"), JSON.stringify({ timeConfigured: false }));
  await writeFile(join(boards, `${DATE}.json`), JSON.stringify({ schemaVersion: 2, activityDate: DATE, quests: [], sourceWarnings: [] }));
}

test("manual task endpoint saves a title-only task as an untimed todo card", async () => {
  const fixture = await startFixtureBridge();
  const { dataDir, baseUrl } = fixture;
  try {
    await createBoard(dataDir);
    const response = await fetch(`${baseUrl}/api/quests/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://tauri.localhost" },
      body: JSON.stringify({ activityDate: DATE, title: "리눅스 학습" }),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://tauri.localhost");
    const result = await response.json();
    assert.equal(result.quest.title, "리눅스 학습");
    assert.equal(result.quest.sourceLabel, "수동 추가");
    assert.equal(result.quest.sourcePath, "manual://widget");
    assert.equal(result.quest.estimateMinutes, 50);
    const focus = result.schedule.blocks.filter((block) => block.type === "focus" && block.questId === result.quest.id);
    assert.equal(focus.length, 1);
    assert.equal(focus[0].startAt, undefined);
    assert.equal(focus[0].endAt, undefined);
    const saved = JSON.parse(await readFile(join(dataDir, "boards", `${DATE}.json`), "utf8"));
    assert.equal(saved.quests.length, 1);
    const activityResponse = await fetch(`${baseUrl}/api/activity?date=${DATE}`);
    assert.equal(activityResponse.status, 200);
    const activity = await activityResponse.json();
    assert.equal(activity.records.at(-1).action, "task_added");
    assert.equal(activity.records.at(-1).subject.title, "리눅스 학습");
    const activityMarkdown = await readFile(join(dataDir, "activity", `${DATE}.md`), "utf8");
    assert.match(activityMarkdown, /작업 추가/);
  } finally {
    await fixture.close();
  }
});

test("manual task endpoint requires only a nonblank title and ignores legacy duration input", async () => {
  const fixture = await startFixtureBridge();
  const { dataDir, baseUrl } = fixture;
  try {
    await createBoard(dataDir);
    const blank = await fetch(`${baseUrl}/api/quests/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE, title: "" }) });
    assert.equal(blank.status, 400);
    const legacyDuration = await fetch(`${baseUrl}/api/quests/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityDate: DATE, title: "리눅스 학습", durationMinutes: 75 }) });
    assert.equal(legacyDuration.status, 201);
  } finally {
    await fixture.close();
  }
});
