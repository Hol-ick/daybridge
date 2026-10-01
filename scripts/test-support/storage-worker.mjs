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
} else if (mode === "lock-race") {
  let acquired = 0;
  let conflicts = 0;
  const deadline = Date.now() + 25000;
  while (acquired < Number(extra)) {
    try {
      const result = await withDateTransaction({ dataDir, date }, async () => ({ result: "acquired" }));
      if (result !== "acquired") throw new Error("Unexpected transaction result");
      acquired += 1;
    } catch (error) {
      // Busy conflicts are the bounded lock contract; creation failures must surface.
      if (error.code !== "storage_conflict" || !error.message.startsWith("Storage is busy") || Date.now() >= deadline) throw error;
      conflicts += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (acquired < Number(extra) && Date.now() >= deadline) throw new Error("Lock handover stress deadline exceeded");
  }
  console.log(JSON.stringify({ acquired, conflicts }));
} else if (mode === "read") {
  console.log(JSON.stringify(await loadSchedule(dataDir, date)));
} else if (mode === "compile" || mode === "compile-default") {
  for (let i = 0; i < Number(extra); i += 1) await compile({ maruRoot: dataDir, questPlan: join(dataDir, "plan.json"), sourceDate: date, targetDate: date, ...(mode === "compile" ? { output: join(dataDir, "boards", `${date}.json`) } : {}) });
} else {
  throw new Error("Unknown fixture worker mode.");
}
