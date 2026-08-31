import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readActivityLog, recordActivity } from "./activity-log.mjs";

const DATE = "2099-01-04";

test("activity log keeps sanitized, chronological user actions in Markdown and NDJSON", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "daybridge-activity-log-"));
  try {
    await recordActivity(dataDir, {
      activityDate: DATE,
      occurredAt: "2099-01-04T00:03:00.000Z",
      action: "task_added",
      subject: { id: "quest-1", questId: "quest-1", title: "리눅스 학습" },
      details: { durationMinutes: 50, reason: "C:\\private\\note" },
    });
    await recordActivity(dataDir, {
      activityDate: DATE,
      occurredAt: "2099-01-04T00:05:00.000Z",
      action: "status_changed",
      subject: { id: "block-1", questId: "quest-1", title: "리눅스 학습" },
      details: { status: "completed" },
    });
    const records = await readActivityLog(dataDir, DATE);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((record) => record.action), ["task_added", "status_changed"]);
    assert.equal(records[0].details.reason, "[local path]");
    const markdown = await readFile(join(dataDir, "activity", `${DATE}.md`), "utf8");
    assert.match(markdown, /작업 추가/);
    assert.match(markdown, /상태 변경/);
    assert.doesNotMatch(markdown, /C:\\private/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
