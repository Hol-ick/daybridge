import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { atomicWriteJson, delay, readJsonStrict, StoreError, writeJsonDirect } from "./json-store.mjs";
import { transactionContext } from "./transaction-context.mjs";

const queues = new Map();
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) || date === "global";

function ownerDead(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || typeof owner.token !== "string") return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

async function lockOwner(path) {
  try { return await readJsonStrict(path); }
  catch { return null; } // Unreadable/unknown owners are never evidence of death.
}

async function reclaimDeadLock(path) {
  const gate = path + ".reclaim";
  let handle;
  try { handle = await open(gate, "wx"); }
  catch (error) { if (error.code === "EEXIST") return; throw error; }
  try {
    const owner = await lockOwner(path);
    if (ownerDead(owner)) await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; });
  } finally { await handle.close(); await unlink(gate); }
}

async function acquire(path, date) {
  const token = randomUUID();
  const deadline = Date.now() + 2000;
  while (true) {
    let handle;
    try {
      handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ schemaVersion: 1, pid: process.pid, token, date, createdAt: new Date().toISOString() }));
      await handle.sync();
      await handle.close();
      return async () => {
        const owner = await lockOwner(path);
        if (owner?.token !== token) throw new StoreError("storage_conflict", "Storage lock ownership changed; the lock was preserved.");
        await unlink(path);
      };
    } catch (error) {
      await handle?.close();
      if (error.code !== "EEXIST") throw new StoreError("storage_lock_failed", "Storage lock could not be acquired; preserve the lock files.", error);
      const owner = await lockOwner(path);
      if (ownerDead(owner)) await reclaimDeadLock(path);
      if (Date.now() >= deadline) throw new StoreError("storage_conflict", "Storage is busy or its lock owner is unknown; retry after the owner exits.");
      await delay(20);
    }
  }
}

function targetPath(dataDir, name) {
  if (typeof name !== "string" || !name.endsWith(".json") || isAbsolute(name)) throw new StoreError("invalid_journal", "Transaction target is invalid; the journal was preserved.");
  const path = resolve(dataDir, name);
  const rel = relative(dataDir, path);
  if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel) || rel.split(/[\\/]/)[0].toLowerCase().replace(/[. ]+$/, "") === ".transactions") {
    throw new StoreError("invalid_journal", "Transaction target escapes the data boundary; the journal was preserved.");
  }
  return path;
}

async function assertPhysicalBoundary(dataDir, path, forbidJournalDirectory = true) {
  const root = await realpath(dataDir);
  let ancestor = path;
  while (true) {
    try {
      const physical = await realpath(ancestor);
      const rel = relative(root, physical);
      if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) throw new StoreError("invalid_journal", "Transaction target follows a link outside the data boundary; preserve the journal.");
      if (forbidJournalDirectory && rel.split(/[\\/]/)[0].toLowerCase() === ".transactions") throw new StoreError("invalid_journal", "Transaction data cannot overwrite its own recovery directory.");
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

function validateJournal(journal, date, dataDir) {
  if (journal?.schemaVersion !== 1 || journal.date !== date || !validDate(date) || typeof journal.transactionId !== "string"
      || !["prepared", "settled"].includes(journal.state) || !Array.isArray(journal.writes)) {
    throw new StoreError("invalid_journal", "Transaction journal is invalid; preserve it before repairing storage.");
  }
  const names = new Set();
  for (const write of journal.writes) {
    const path = targetPath(dataDir, write?.path);
    if (names.has(path) || write.value === null || typeof write.value !== "object") throw new StoreError("invalid_journal", "Transaction journal contains invalid final values; the journal was preserved.");
    names.add(path);
  }
  return journal;
}

async function applyJournal(dataDir, journal, journalPath, onCommitStep) {
  // Refuse to overwrite newly damaged files, even during recovery.
  for (const write of journal.writes) {
    await assertPhysicalBoundary(dataDir, targetPath(dataDir, write.path));
    await readJsonStrict(targetPath(dataDir, write.path));
  }
  for (let index = 0; index < journal.writes.length; index += 1) {
    const write = journal.writes[index];
    await writeJsonDirect(targetPath(dataDir, write.path), write.value);
    await onCommitStep?.({ index, path: write.path, transactionId: journal.transactionId });
  }
  await writeJsonDirect(journalPath, { ...journal, state: "settled", settledAt: new Date().toISOString() });
}

async function recoverPrepared(dataDir, directory) {
  for (const name of (await readdir(directory)).sort()) {
    const match = name.match(/^(\d{4}-\d{2}-\d{2}|global)\.journal\.json$/);
    if (!match) continue;
    const path = join(directory, name);
    let journal;
    try { journal = validateJournal(await readJsonStrict(path), match[1], dataDir); }
    catch (error) { throw new StoreError("storage_recovery_failed", "Storage recovery stopped on a damaged journal; the original journal was preserved.", error); }
    if (journal.state === "prepared") await applyJournal(dataDir, journal, path);
  }
}

export async function withDateTransaction({ dataDir, date, onCommitStep }, fn) {
  const root = resolve(dataDir);
  if (!validDate(date)) throw new TypeError("Transaction date must use YYYY-MM-DD.");
  if (transactionContext.getStore()) throw new StoreError("nested_transaction", "Open the transaction at the outer operation boundary.");
  const previous = queues.get(root) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const directory = join(root, ".transactions");
    await mkdir(directory, { recursive: true });
    await assertPhysicalBoundary(root, directory, false);
    // Date state also updates shared latest/settings files. This short store gate
    // prevents another date or compiler from observing a partially applied journal.
    const releaseStore = await acquire(join(directory, "store.lock"), date);
    let releaseDate;
    try {
      releaseDate = await acquire(join(directory, `${date}.lock`), date);
      await recoverPrepared(root, directory);
      const context = { dataDir: root, date, writes: new Map() };
      const packet = await transactionContext.run(context, async () => {
        const snapshot = {
          board: date === "global" ? null : await readJsonStrict(join(root, "boards", `${date}.json`)),
          schedule: date === "global" ? null : await readJsonStrict(join(root, "schedules", `${date}.json`)),
          read: (name) => readJsonStrict(targetPath(root, name)),
        };
        const answer = await fn(snapshot);
        if (Array.isArray(answer?.writes)) {
          for (const write of answer.writes) await atomicWriteJson(targetPath(root, write.path), write.value);
        }
        return { result: answer?.result, writes: [...context.writes].map(([path, value]) => ({ path, value })) };
      });
      if (packet.writes.length) {
        const journal = validateJournal({ schemaVersion: 1, transactionId: randomUUID(), date, state: "prepared", preparedAt: new Date().toISOString(), writes: packet.writes }, date, root);
        const journalPath = join(directory, `${date}.journal.json`);
        // Check every destination before preparing the durable final-values record.
        for (const write of journal.writes) {
          await assertPhysicalBoundary(root, targetPath(root, write.path));
          await readJsonStrict(targetPath(root, write.path));
        }
        await writeJsonDirect(journalPath, journal);
        await applyJournal(root, journal, journalPath, onCommitStep);
      }
      return packet.result;
    } finally {
      try { await releaseDate?.(); } finally { await releaseStore(); }
    }
  });
  queues.set(root, operation);
  try { return await operation; }
  finally { if (queues.get(root) === operation) queues.delete(root); }
}

export async function runStoreOperation(dataDir, date, operation) {
  const context = transactionContext.getStore();
  if (context && context.dataDir === resolve(dataDir)) return await operation();
  return await withDateTransaction({ dataDir, date }, async () => ({ result: await operation() }));
}
