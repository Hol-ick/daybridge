import { createHash } from "node:crypto";
import { join } from "node:path";
import { runStoreOperation } from "../storage/date-transaction.mjs";
import { atomicWriteJson, readJsonStrict, StoreError } from "../storage/json-store.mjs";
import { RequestError } from "./request-policy.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => createHash("sha256").update(value).digest("hex");

// Request records are durable receipts. No automatic expiry: removing one would
// silently turn a supported retry into a new mutation.
export async function applyMutation({ dataDir, date, requestId, kind, payload }, execute) {
  if (requestId === undefined) return await runStoreOperation(dataDir, date, async () => ({ result: await execute(), replayed: false }));
  if (typeof requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) {
    throw new RequestError(400, "invalid_request_id", "Request ID must contain 1–128 safe ASCII characters.");
  }
  const payloadHash = hash(JSON.stringify(canonical({ date, kind, payload })));
  const path = join(dataDir, "requests", `${hash(requestId)}.json`);
  return await runStoreOperation(dataDir, date, async () => {
    const receipt = await readJsonStrict(path);
    if (receipt) {
      if (receipt.schemaVersion !== 1 || receipt.requestId !== requestId || !/^[a-f0-9]{64}$/.test(receipt.payloadHash)
          || typeof receipt.kind !== "string" || typeof receipt.date !== "string" || !receipt.result || typeof receipt.result !== "object" || Array.isArray(receipt.result)) {
        throw new StoreError("invalid_request_record", "Stored request receipt is invalid; preserve it before retrying.");
      }
      if (receipt.payloadHash !== payloadHash) throw new RequestError(409, "request_id_conflict", "This request ID was already used for another change.");
      return { result: receipt.result, replayed: true };
    }
    const result = await execute();
    await atomicWriteJson(path, { schemaVersion: 1, requestId, payloadHash, kind, date, result, createdAt: new Date().toISOString() });
    return { result, replayed: false };
  });
}
