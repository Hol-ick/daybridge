import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compile, nextBusinessDay, titleFor } from "./compile-quests.mjs";

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function makeCloseout(root, date = "2026-08-10") {
  const system = join(root, "04_Operations_And_Automation", "Memory_System", "reports", "daily", "_system");
  mkdirSync(system, { recursive: true });
  writeJson(join(system, `${date}_briefing_synthesis.json`), {
    schema_version: "1.0",
    artifact_type: "aihub_briefing_synthesis",
    activity_date: date,
    phase: "closeout",
    status: "ready",
    coverage: { record_quality: "aligned", conversation_label: "연결 확인" },
    execution: { closeout_status: "success", health_status: "healthy", record_quality: "aligned" },
    tomorrow_first_steps: [
      {
        title: "MT 202 공식 원문을 대조한다",
        label: "확인 필요",
        first_step: "공식 원문 위치를 확인한다",
        done_when: "필드 규칙과 원문 위치를 기록한다",
        evidence: "04_Operations_And_Automation/Skills_And_Prompts/worklogs/swift.md",
      },
      {
        title: "핵심 20개 용어를 공식 문장으로 확인한다",
        label: "로컬 기록상",
        first_step: "첫 5개 용어의 공식 문장을 찾는다",
        done_when: "5개 용어의 근거를 기록한다",
        evidence: "04_Operations_And_Automation/Skills_And_Prompts/worklogs/swift.md",
      },
    ],
    open_items: [
      {
        title: "TCG 운영 배포 권한을 확인한다",
        label: "막힘",
        next_step: "배포 권한 보유자를 확인한다",
        evidence: "01_Projects/TCG_Trade_Web/worklogs/rollout.md",
      },
      {
        title: "217개 카드에 원문 확인 필요 Detail이 남아 있다. 실제 학습용 확정판에서는 원문 위치를 사람이 확인해야 한다.",
        label: "미완료",
      },
    ],
    confirmation_questions: [
      "오늘 Codex/ChatGPT 회사 업무 세션의 실제 activity coverage",
      "MT 202 공식 원문 대조를 오늘 시작할 수 있나요?",
    ],
    completed_today: [{ title: "완료된 UI 수정", status: "완료 기록" }],
  });
  writeJson(join(system, `${date}_unified.json`), {
    activity_date: date,
    work: {
      worklog_records: [
        {
          project: "DeckHub",
          title: "MT 202 공식 원문을 대조한다",
          evidence_refs: ["04_Operations_And_Automation/Skills_And_Prompts/worklogs/swift.md"],
        },
      ],
    },
  });
}

test("nextBusinessDay skips the weekend", () => {
  assert.equal(nextBusinessDay("2026-08-14"), "2026-08-17");
});

test("long card-evidence statements become concise action titles", () => {
  assert.equal(
    titleFor("217개 카드에 원문 확인 필요 Detail이 남아 있다. 실제 학습용 확정판에서는 원문 위치를 사람이 확인해야 한다."),
    "217개 카드 원문 근거 확인하기",
  );
});

test("closeout compiler groups workstream actions and retains state", () => {
  const root = mkdtempSync(join(tmpdir(), "daybridge-closeout-"));
  const output = join(root, "board.json");
  try {
    makeCloseout(root);
    const first = compile({ source: "closeout", sourceDate: "2026-08-10", targetDate: "2026-08-11", aihubRoot: root, output });
    assert.equal(first.sourceCoverage, "connected");
    assert.ok(first.quests.length >= 2);
    assert.ok(first.quests.filter((quest) => quest.category === "main").length <= 5);
    assert.ok(first.quests.some((quest) => quest.steps.length >= 2));
    assert.ok(first.quests.every((quest) => quest.status !== "completed"));
    assert.ok(first.quests.every((quest) => !/activity coverage/i.test(quest.title)));

    const kept = first.quests[0];
    writeJson(output, { ...first, quests: first.quests.map((quest) => quest.id === kept.id ? { ...quest, status: "in_progress", reports: [{ id: "receipt-1" }] } : quest) });
    const second = compile({ source: "closeout", sourceDate: "2026-08-10", targetDate: "2026-08-11", aihubRoot: root, output });
    assert.equal(second.quests.find((quest) => quest.id === kept.id)?.status, "in_progress");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("future closeout packets become an attention board instead of a quest board", () => {
  const root = mkdtempSync(join(tmpdir(), "daybridge-future-"));
  try {
    makeCloseout(root, "2099-01-01");
    const board = compile({ source: "closeout", sourceDate: "2099-01-01", targetDate: "2099-01-02", aihubRoot: root, print: true });
    assert.equal(board.sourceCoverage, "attention");
    assert.equal(board.quests.length, 0);
    assert.ok(board.sourceWarnings.some((warning) => /future/i.test(warning)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
