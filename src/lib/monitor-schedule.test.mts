import assert from "node:assert/strict";
import test from "node:test";

async function loadModule() {
  return import("./monitor-schedule.ts");
}

const TICK = 60_000;
const start = Date.parse("2026-10-15T12:00:00.000Z");

// Simulates the scheduler ticking every minute (with a little jitter) and
// returns the tick numbers on which the monitor was checked.
async function checkedTicks(intervalSeconds: number, ticks: number, jitterMs = 0) {
  const { isMonitorDue } = await loadModule();
  const monitor = { interval: intervalSeconds, lastCheckedAt: null as Date | null };
  const checked: number[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const cycleStartedAt = start + tick * TICK + (tick % 2 === 0 ? jitterMs : -jitterMs);
    if (isMonitorDue(monitor, cycleStartedAt)) {
      checked.push(tick);
      monitor.lastCheckedAt = new Date(cycleStartedAt);
    }
  }
  return checked;
}

test("a monitor with no previous check is due", async () => {
  const { isMonitorDue } = await loadModule();
  assert.equal(isMonitorDue({ interval: 300, lastCheckedAt: null }, start), true);
});

test("monitors run on every tick that matches their interval", async () => {
  assert.deepEqual(await checkedTicks(60, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(await checkedTicks(120, 7), [0, 2, 4, 6]);
  assert.deepEqual(await checkedTicks(300, 11), [0, 5, 10]);
});

test("tick jitter does not push a check to the following tick", async () => {
  assert.deepEqual(await checkedTicks(120, 7, 1_500), [0, 2, 4, 6]);
  assert.deepEqual(await checkedTicks(60, 4, 1_500), [0, 1, 2, 3]);
});

test("a monitor is never checked a tick early", async () => {
  const { isMonitorDue } = await loadModule();
  const lastCheckedAt = new Date(start);
  assert.equal(isMonitorDue({ interval: 120, lastCheckedAt }, start + TICK), false);
  assert.equal(isMonitorDue({ interval: 120, lastCheckedAt }, start + 2 * TICK), true);
});
