import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compile, nextBusinessDay, titleFor } from "./compile-quests.mjs";

function writeJson(path, value) { writeFileSync(path, JSON.stringify(value, null, 2), "utf8"); }
function planFixture() { return { artifact_type: "daybridge_quest_plan", schema_version: "1.0", status: "ready", source: { quality: "aligned" }, quests: [
  { id: "q-source", mission_id: "m-guide", title: "Check the official source", project: "Learning", actor: "user", kind: "review", priority: "must", execution: "sequential", first_action: "Open the source", done_when: "The source outcome is recorded", steps: [{ id: "s-open", label: "Open the source" }, { id: "s-record", label: "Record the outcome", depends_on: ["s-open"] }] },
  { id: "q-write", mission_id: "m-guide", title: "Write the verified note", project: "Learning", actor: "user", kind: "execute", priority: "should", depends_on: ["q-source"], first_action: "Draft the note", steps: [{ id: "s-draft", label: "Draft the note" }] },
] }; }

test("nextBusinessDay skips the weekend", () => assert.equal(nextBusinessDay("2026-08-14"), "2026-08-17"));
test("long card-evidence statements become concise action titles", () => assert.equal(titleFor("217개 카드에 원문 확인 필요 Detail이 남아 있다."), "217개 카드 원문 근거 확인하기"));

test("quest plan preserves atomic work, explicit sequence, and mission progress", () => {
  const root = mkdtempSync(join(tmpdir(), "daybridge-plan-")); const planPath = join(root, "plan.json"); const output = join(root, "board.json");
  try { writeJson(planPath, planFixture()); const board = compile({ questPlan: planPath, sourceDate: "2026-08-11", targetDate: "2026-08-12", output }); assert.equal(board.sourceCoverage, "connected"); assert.equal(board.quests.length, 2); assert.equal(board.quests[0].execution, "sequential"); assert.deepEqual(board.quests[0].steps[1].dependsOn, ["s-open"]); assert.deepEqual(board.quests[1].dependsOn, ["q-source"]); assert.equal(board.missions[0].progress.total, 3); writeJson(output, { ...board, quests: board.quests.map((quest) => quest.id === "q-source" ? { ...quest, state: "in_progress", status: "in_progress", steps: quest.steps.map((step) => step.id === "s-open" ? { ...step, completed: true } : step) } : quest) }); const refreshed = compile({ questPlan: planPath, sourceDate: "2026-08-12", targetDate: "2026-08-13", output }); const kept = refreshed.quests.find((quest) => quest.id === "q-source"); assert.equal(kept.state, "in_progress"); assert.equal(kept.progress.completed, 1); assert.equal(kept.carryoverCount, 1); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("independent quests do not invent sub-quests", () => {
  const root = mkdtempSync(join(tmpdir(), "daybridge-independent-")); const planPath = join(root, "plan.json"); const output = join(root, "board.json");
  try {
    writeJson(planPath, { artifact_type: "daybridge_quest_plan", status: "ready", quests: [{ id: "q-one", title: "Prepare the briefing", execution: "independent", steps: [{ id: "s-a", label: "Open the note" }, { id: "s-b", label: "Write the result" }] }] });
    const board = compile({ questPlan: planPath, sourceDate: "2026-08-11", targetDate: "2026-08-12", output });
    assert.equal(board.quests[0].steps.length, 1);
    assert.equal(board.quests[0].steps[0].label, "Open the note");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("8/13 quest quality keeps source warnings, exclusions, and safe atomic cards", () => {
  const root = mkdtempSync(join(tmpdir(), "daybridge-quality-")); const planPath = join(root, "plan.json"); const output = join(root, "board.json");
  try {
    writeJson(planPath, {
      artifact_type: "daybridge_quest_plan",
      status: "ready",
      source: { quality: "aligned", coverage: "attention", warnings: ["Conversation coverage is unavailable.", "Session archive is blocked."] },
      excluded: [{ title: "Ask whether the review is complete", reason: "Confirmation question is not an automatic quest." }],
      quests: [
        { id: "q-path", title: "Check the old KTH path", summary: "The old path may return.", first_step: "Check the old KTH path", current_action: "Check the old KTH path", execution: "sequential", steps: [
          { id: "s-check", label: "Check the old KTH process" },
          { id: "s-recheck", label: "Recheck the path after stopping it", depends_on: ["s-check"] },
          { id: "s-restart", label: "Restart the project from the current logical root", depends_on: ["s-recheck"] },
        ] },
        { id: "q-deploy", title: "Confirm 4f56665 public asset", first_step: "Check the public bundle", steps: [{ id: "s-one", label: "Check the public bundle" }] },
        { id: "q-thread", title: "Retry Codex conversation coverage", first_step: "Retry bounded list_threads access", steps: [{ id: "s-thread", label: "Retry bounded list_threads access" }] },
      ],
    });
    const board = compile({ questPlan: planPath, sourceDate: "2026-08-13", targetDate: "2026-08-14", output });
    assert.equal(board.sourceCoverage, "attention");
    assert.deepEqual(board.sourceWarnings, ["Conversation coverage is unavailable.", "Session archive is blocked."]);
    assert.equal(board.quests.length, 3);
    assert.equal(board.quests[0].execution, "sequential");
    assert.deepEqual(board.quests[0].steps.map((step) => step.dependsOn), [[], ["s-check"], ["s-recheck"]]);
    assert.equal(board.excluded.length, 1);
    assert.equal(board.excluded[0].reason, "Confirmation question is not an automatic quest.");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("user cards reject local paths and future source packets", () => {
  const root = mkdtempSync(join(tmpdir(), "daybridge-boundaries-")); const planPath = join(root, "plan.json"); const output = join(root, "board.json");
  try {
    const localPath = ["<drive>:", "fixture", "legacy-root"].join("\\");
    writeJson(planPath, { artifact_type: "daybridge_quest_plan", status: "ready", quests: [
      { id: "q-local", title: `Check ${localPath}`, first_step: `Check ${localPath}`, steps: [{ id: "s-local", label: `Check ${localPath}` }] },
    ] });
    const board = compile({ questPlan: planPath, sourceDate: "2099-01-01", targetDate: "2026-08-14", output });
    assert.equal(board.quests.length, 0);
    assert.ok(board.sourceWarnings.some((warning) => /future/i.test(warning)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy closeout fallback is visibly attention and future packets are safe", () => {
  const root = mkdtempSync(join(tmpdir(), "daybridge-legacy-")); const system = join(root, "04_Operations_And_Automation", "Memory_System", "reports", "daily", "_system");
  try { const date = "2099-01-01"; const path = join(system, `${date}_briefing_synthesis.json`); mkdirSync(system, { recursive: true }); writeJson(path, { artifact_type: "aihub_briefing_synthesis", phase: "closeout", status: "ready", coverage: { record_quality: "aligned" }, immediate_actions: [{ title: "Check the source", first_step: "Open it" }] }); const board = compile({ source: "closeout", sourceDate: date, targetDate: "2026-08-14", aihubRoot: root, print: true }); assert.equal(board.sourceCoverage, "attention"); assert.equal(board.quests.length, 0); assert.ok(board.sourceWarnings.some((warning) => /future/i.test(warning))); } finally { rmSync(root, { recursive: true, force: true }); }
});
