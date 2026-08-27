import test from "node:test";
import assert from "node:assert/strict";
import { resolveActivityDate } from "./activity-date.js";

test("today view ignores a persisted board from an earlier date", () => {
  assert.equal(resolveActivityDate({ activityDate: "2026-08-25" }, "2026-08-27"), "2026-08-27");
});

test("today view keeps today's board date", () => {
  assert.equal(resolveActivityDate({ activityDate: "2026-08-27" }, "2026-08-27"), "2026-08-27");
});

test("today view falls back to the supplied current date when the board is absent", () => {
  assert.equal(resolveActivityDate(null, "2026-08-27"), "2026-08-27");
});
