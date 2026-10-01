import { join } from "node:path";
import { compile } from "../compile-quests.mjs";
import { loadSchedule, reportScheduleBlock } from "../schedule-store.mjs";
import { withDateTransaction } from "../storage/date-transaction.mjs";

const [mode, dataDir, date, extra] = process.argv.slice(2);
if (mode === "reports") {
  for (const id of JSON.parse(extra)) await reportScheduleBlock(dataDir, date, { blockId: id, status: "completed" });
} else if (mode === "increment") {
  for (let i = 0; i < Number(extra); i += 1) {
    await withDateTransaction({ dataDir, date }, async ({ board }) => ({ writes: [
      { path: `boards/${date}.json`, value: { activityDate: date, counter: (board?.counter || 0) + 1, quests: [] } },
    ], result: true }));
  }
} else if (mode === "crash") {
  await withDateTransaction({ dataDir, date, onCommitStep({ index }) { if (index === 0) process.exit(23); } }, async () => ({ writes: [
    { path: `boards/${date}.json`, value: { activityDate: date, quests: [], marker: "recovered" } },
    { path: `schedules/${date}.json`, value: { date, mode: "todo", blocks: [], marker: "recovered" } },
  ] }));
} else if (mode === "read") {
  console.log(JSON.stringify(await loadSchedule(dataDir, date)));
} else if (mode === "compile" || mode === "compile-default") {
  for (let i = 0; i < Number(extra); i += 1) await compile({ maruRoot: dataDir, questPlan: join(dataDir, "plan.json"), sourceDate: date, targetDate: date, ...(mode === "compile" ? { output: join(dataDir, "boards", `${date}.json`) } : {}) });
} else {
  throw new Error("Unknown fixture worker mode.");
}
