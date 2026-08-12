import type { QuestBoard } from "./types";

const makeQuest = (id: string, title: string, project: string, priority: "must" | "should" | "could", state: "ready" | "in_progress" | "deferred" | "completed", labels: string[]) => ({
  id, missionId: `mission-${project.toLowerCase().replace(/\s+/g, "-")}`, title, project, priority, kind: "execute" as const, execution: "sequential" as const, dependsOn: [], state, status: state, summary: `A focused ${project.toLowerCase()} action with one observable outcome.`, firstStep: labels[0], currentAction: labels.find((_, index) => index === 0), doneWhen: "The result is recorded.", estimateMinutes: labels.length * 15, progress: { completed: state === "completed" ? labels.length : 0, total: labels.length }, carryoverCount: state === "deferred" ? 1 : 0, steps: labels.map((label, index) => ({ id: `${id}-step-${index + 1}`, label, completed: state === "completed", order: index + 1, dependsOn: index ? [`${id}-step-${index}`] : [] })), sourceLabel: "Demo plan", sourcePath: "demo://quest-plan", sourceRefs: ["demo://daily-note"], reports: [],
});

export const demoQuestBoard: QuestBoard = {
  schemaVersion: 2,
  activityDate: "2026-08-11",
  title: "Today’s quest log",
  generatedAt: "2026-08-11T09:05:00+09:00",
  sourceCoverage: "demo",
  missions: [],
  quests: [
    makeQuest("confirm-direct-request", "Confirm the owner for a direct work request", "Inbox", "must", "ready", ["Capture the request scope", "Confirm the owner"]),
    makeQuest("repair-reference-link", "Repair the learning-guide reference link", "Learning materials", "must", "in_progress", ["Locate the old reference", "Verify its replacement", "Record the verified change"]),
    { ...makeQuest("apply-module-template", "Apply the detailed explanation template", "Learning materials", "should", "ready", ["Choose the target module", "Apply the explanation pattern"]), dependsOn: ["repair-reference-link"] },
    makeQuest("verify-manual-evidence", "Start a small evidence verification batch", "Knowledge review", "should", "ready", ["Select five entries", "Check each source"]),
    makeQuest("wait-for-source-access", "Decide the official-source access path", "Knowledge review", "could", "deferred", ["Record the access decision"]),
  ],
};
