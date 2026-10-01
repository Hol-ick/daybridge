import { mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runStoreOperation } from "../storage/date-transaction.mjs";
import { transactionContext } from "../storage/transaction-context.mjs";
import { atomicWriteJson, readJsonStrict, StoreError } from "../storage/json-store.mjs";

function validate(record) {
  if (record?.schemaVersion !== 1 || !["pending", "sent"].includes(record.state)
      || !/^[A-Za-z0-9_-]{1,128}$/.test(record.event?.id || "") || !/^\d{4}-\d{2}-\d{2}$/.test(record.event?.activityDate || "")) {
    throw new StoreError("invalid_outbox", "Handoff outbox is damaged; preserve it before retrying.");
  }
  return record;
}

export async function enqueueHandoff({ dataDir, event }) {
  const record = validate({ schemaVersion: 1, state: "pending", event });
  return await runStoreOperation(dataDir, event.activityDate, async () => {
    const path = join(dataDir, "outbox", event.id + ".json");
    const existing = await readJsonStrict(path);
    if (existing) {
      validate(existing);
      if (JSON.stringify(existing.event) !== JSON.stringify(event)) throw new StoreError("outbox_conflict", "Event ID already belongs to a different handoff.");
      return existing;
    }
    await atomicWriteJson(path, record);
    return record;
  });
}

export async function flushHandoffOutbox({ dataDir, sinkDir, limit = 20, onDelivered }) {
  if (transactionContext.getStore()) throw new StoreError("outbox_before_commit", "Deliver handoffs only after the local transaction commits.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError("Outbox limit must be 1–100.");
  const target = typeof sinkDir === "string" && sinkDir.trim() ? resolve(sinkDir) : null;
  if (target) {
    let ancestor = target;
    let physical;
    while (true) {
      try { physical = resolve(await realpath(ancestor), relative(ancestor, target)); break; }
      catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
    const rel = relative(await realpath(dataDir), physical);
    if (!(rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel))) throw new StoreError("invalid_handoff_sink", "Handoff destination must be outside local storage.");
  }
  return await runStoreOperation(dataDir, "global", async () => {
    const directory = join(dataDir, "outbox");
    await mkdir(directory, { recursive: true });
    const records = [];
    for (const name of (await readdir(directory)).sort()) {
      if (!name.endsWith(".json")) continue;
      const record = validate(await readJsonStrict(join(directory, name)));
      if (name !== record.event.id + ".json") throw new StoreError("invalid_outbox", "Outbox filename and event ID disagree.");
      if (record.state === "pending") records.push({ path: join(directory, name), record });
    }
    let sent = 0;
    let failed = 0;
    if (target) for (const { path, record } of records.slice(0, limit)) {
      try {
        const destination = join(target, record.event.activityDate, record.event.id + ".json");
        const existing = await readJsonStrict(destination);
        if (existing && JSON.stringify(existing) !== JSON.stringify(record.event)) throw new StoreError("handoff_conflict", "Destination event has different content; it was preserved.");
        await atomicWriteJson(destination, record.event);
        await onDelivered?.(record.event);
        await atomicWriteJson(path, { ...record, state: "sent", sentAt: new Date().toISOString() });
        sent++;
      } catch { failed++; }
    }
    return { sent, pending: records.length - sent, failed };
  });
}
