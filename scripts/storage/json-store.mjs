import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pendingJson, stageJson } from "./transaction-context.mjs";

export class StoreError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "StoreError";
    this.code = code;
    this.status = code === "storage_conflict" ? 409 : 500;
  }
}

function parse(text) {
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch (error) { throw new StoreError("corrupt_json", "Stored JSON is damaged; preserve the file and repair it before retrying.", error); }
  if (value === null || typeof value !== "object") throw new StoreError("invalid_record", "Stored JSON must contain an object or array; the original file was preserved.");
  return value;
}

export async function readJsonStrict(path) {
  const pending = pendingJson(path);
  if (pending.found) return pending.value;
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new StoreError("storage_read_failed", "Stored JSON could not be read; the original file was preserved.", error);
  }
  return parse(text);
}

export function readJsonStrictSync(path) {
  const pending = pendingJson(path);
  if (pending.found) return pending.value;
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new StoreError("storage_read_failed", "Stored JSON could not be read; the original file was preserved.", error);
  }
  return parse(text);
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function atomicWriteJson(path, value) {
  await readJsonStrict(path);
  if (stageJson(path, value)) return;
  await writeJsonDirect(path, value);
}

export async function writeJsonDirect(path, value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    await mkdir(dirname(path), { recursive: true });
    handle = await open(temporary, "wx");
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, path); break; }
      catch (error) {
        if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 4) throw error;
        await delay(10 * 2 ** attempt);
      }
    }
  } catch (error) { throw new StoreError("storage_write_failed", "Stored JSON could not be saved; preserve the original and transaction files.", error); }
  finally { await handle?.close(); }
}

export function atomicWriteJsonSync(path, value) {
  readJsonStrictSync(path);
  if (stageJson(path, value)) return;
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    mkdirSync(dirname(path), { recursive: true });
    handle = openSync(temporary, "wx");
    writeFileSync(handle, JSON.stringify(value, null, 2) + "\n", "utf8");
    fsyncSync(handle);
    closeSync(handle);
    handle = null;
    for (let attempt = 0; ; attempt += 1) {
      try { renameSync(temporary, path); break; }
      catch (error) {
        if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 4) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** attempt);
      }
    }
  } catch (error) { throw new StoreError("storage_write_failed", "Stored JSON could not be saved; preserve the original and temporary files.", error); }
  finally { if (handle !== null && handle !== undefined) closeSync(handle); }
}
