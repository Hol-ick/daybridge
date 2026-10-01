import { AsyncLocalStorage } from "node:async_hooks";
import { isAbsolute, relative, resolve } from "node:path";

export const transactionContext = new AsyncLocalStorage();
export function stagedFile(path) {
  const context = transactionContext.getStore();
  if (!context) return null;
  const absolute = resolve(path);
  const rel = relative(context.dataDir, absolute);
  if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) return null;
  return { context, absolute, relative: rel };
}

export function stageJson(path, value) {
  const file = stagedFile(path);
  if (!file) return false;
  file.context.writes.set(file.relative, JSON.parse(JSON.stringify(value)));
  return true;
}

export function pendingJson(path) {
  const file = stagedFile(path);
  if (!file?.context.writes.has(file.relative)) return { found: false };
  return { found: true, value: structuredClone(file.context.writes.get(file.relative)) };
}
