import test from "node:test";
import assert from "node:assert/strict";
import { renameRuntime } from "./rename-runtime.mjs";

test("runtime publication retries transient locks and preserves permanent failures", async () => {
  let calls = 0;
  await renameRuntime("source", "target", { move: async () => { if (++calls < 3) throw Object.assign(new Error("locked"), { code: "EPERM" }); }, pause: async () => {} });
  assert.equal(calls, 3);
  const error = Object.assign(new Error("missing"), { code: "ENOENT" });
  calls = 0;
  await assert.rejects(renameRuntime("source", "target", { move: async () => { calls++; throw error; }, pause: async () => {} }), value => value === error);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(renameRuntime("source", "target", { move: async () => { calls++; throw Object.assign(new Error("locked"), { code: "EBUSY" }); }, pause: async () => {} }), /locked/);
  assert.equal(calls, 7);
});
