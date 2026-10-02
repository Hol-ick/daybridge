import test from "node:test";
import assert from "node:assert/strict";
import { createAutosave } from "./autosave.js";
const tick = () => new Promise(resolve => setImmediate(resolve));

test("slow save cannot overwrite a newer edit and pending edits coalesce", async () => {
  const writes = [], states = [];
  let release;
  const first = new Promise(resolve => { release = resolve; });
  const writer = createAutosave(async text => { writes.push(text); if (writes.length === 1) await first; }, state => states.push(state));
  writer.update("첫 글"); writer.update("중간"); writer.update("마지막 📝");
  assert.deepEqual(writes, ["첫 글"]);
  release(); await tick();
  assert.deepEqual(writes, ["첫 글", "마지막 📝"]);
  assert.equal(states.at(-1), "saved");
});

test("failed save keeps latest contents and retries an empty memo", async () => {
  const writes = [], states = [];
  let fail = true;
  const writer = createAutosave(async text => { if (fail) throw Error("disk full"); writes.push(text); }, state => states.push(state));
  writer.update("원본"); writer.update(""); await tick();
  assert.equal(states.at(-1), "error");
  fail = false; writer.retry(); await tick();
  assert.deepEqual(writes, [""]);
  assert.equal(states.at(-1), "saved");
});
