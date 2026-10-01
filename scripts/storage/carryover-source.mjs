import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadSchedule } from "../schedule-store.mjs";
import { runStoreOperation } from "./date-transaction.mjs";
import { readJsonStrict, StoreError } from "./json-store.mjs";

export async function findCarryoverSource({ dataDir, beforeDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beforeDate || "")) throw new TypeError("Carryover date must use YYYY-MM-DD.");
  return await runStoreOperation(dataDir, beforeDate, async () => {
    let names;
    try { names = await readdir(join(dataDir, "schedules")); }
    catch (error) {
      if (error.code === "ENOENT") return null;
      throw new StoreError("storage_read_failed", "Schedule history could not be read; preserve it before retrying.", error);
    }
    const dates = names.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).map(name => name.slice(0, 10)).filter(date => date < beforeDate).sort().reverse();
    if (!dates.length) return null;
    const sourceDate = dates[0];
    const stored = await readJsonStrict(join(dataDir, "schedules", sourceDate + ".json"));
    if (!stored || stored.date !== sourceDate) throw new StoreError("invalid_record", "Schedule history date does not match its filename; preserve it before retrying.");
    const schedule = await loadSchedule(dataDir, sourceDate);
    // An empty latest schedule is deliberate state, not a missing file. Never
    // skip it and resurrect tasks from an older day.
    return { sourceDate, schedule };
  });
}
