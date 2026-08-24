import assert from "node:assert/strict";
import test from "node:test";

import { getWorkdayCountdown } from "./workday-clock.js";

const at = (hours, minutes, seconds = 0) => new Date(2026, 7, 24, hours, minutes, seconds);

test("counts down to the morning start before 09:00", () => {
  assert.deepEqual(getWorkdayCountdown(at(8, 45)), {
    phase: "before_work",
    label: "근무 시작까지",
    remainingMinutes: 15,
    time: "00:15",
  });
});

test("counts down from the morning start to lunch", () => {
  assert.equal(getWorkdayCountdown(at(9, 0)).time, "02:30");
  assert.equal(getWorkdayCountdown(at(11, 29, 30)).time, "00:01");
  assert.equal(getWorkdayCountdown(at(9, 0)).label, "점심까지");
});

test("counts down from lunch to the afternoon start", () => {
  assert.deepEqual(getWorkdayCountdown(at(11, 30)), {
    phase: "lunch",
    label: "오후 시작까지",
    remainingMinutes: 90,
    time: "01:30",
  });
});

test("counts down from the afternoon start to leaving time", () => {
  assert.deepEqual(getWorkdayCountdown(at(13, 0)), {
    phase: "afternoon",
    label: "퇴근까지",
    remainingMinutes: 300,
    time: "05:00",
  });
  assert.equal(getWorkdayCountdown(at(17, 59, 30)).time, "00:01");
});

test("stops at zero after 18:00", () => {
  assert.deepEqual(getWorkdayCountdown(at(18, 0)), {
    phase: "after_work",
    label: "근무 종료",
    remainingMinutes: 0,
    time: "00:00",
  });
});
