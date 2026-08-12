import type { QuestBoard } from "./types";

const makeQuest = (id: string, title: string, project: string, priority: "must" | "should" | "could", state: "ready" | "in_progress" | "deferred" | "completed", labels: string[]) => ({
  id, missionId: `mission-${project.toLowerCase().replace(/\s+/g, "-")}`, title, project, priority, kind: "execute" as const, execution: "sequential" as const, dependsOn: [], state, status: state, summary: `${project}에서 바로 실행할 수 있는 한 가지 결과를 만듭니다.`, firstStep: labels[0], currentAction: labels.find((_, index) => index === 0), doneWhen: "결과가 기록되면 완료입니다.", estimateMinutes: labels.length * 15, progress: { completed: state === "completed" ? labels.length : 0, total: labels.length }, carryoverCount: state === "deferred" ? 1 : 0, steps: labels.map((label, index) => ({ id: `${id}-step-${index + 1}`, label, completed: state === "completed", order: index + 1, dependsOn: index ? [`${id}-step-${index}`] : [] })), sourceLabel: "데모 브리핑", sourcePath: "demo://quest-plan", sourceRefs: ["demo://daily-note"], reports: [],
});

export const demoQuestBoard: QuestBoard = {
  schemaVersion: 2,
  activityDate: "2026-08-11",
  title: "오늘의 퀘스트",
  generatedAt: "2026-08-11T09:05:00+09:00",
  sourceCoverage: "demo",
  missions: [],
  quests: [
    makeQuest("confirm-direct-request", "직접 요청의 담당자 확인", "받은 요청", "must", "ready", ["요청 범위 정리", "담당자 확인"]),
    makeQuest("repair-reference-link", "학습 자료 링크 바로잡기", "학습 자료", "must", "in_progress", ["기존 링크 찾기", "대체 링크 확인", "변경 내용 기록"]),
    { ...makeQuest("apply-module-template", "상세 설명 템플릿 적용", "학습 자료", "should", "ready", ["대상 모듈 선택", "설명 형식 적용"]), dependsOn: ["repair-reference-link"] },
    makeQuest("verify-manual-evidence", "근거 자료 다섯 건 확인", "지식 검토", "should", "ready", ["확인할 자료 고르기", "각 출처 점검"]),
    makeQuest("wait-for-source-access", "공식 출처 접근 경로 결정", "지식 검토", "could", "deferred", ["접근 방법 기록"]),
  ],
};
