// How often the in-process scheduler starts a check cycle.
export const CHECK_INTERVAL_MS = 60_000;

// Ticks drift by a little (request latency, timer jitter), so a monitor whose
// interval is a multiple of the tick would otherwise miss its tick and wait a
// whole extra one. Half a tick absorbs the jitter without ever running early.
const DUE_GRACE_MS = CHECK_INTERVAL_MS / 2;

/**
 * A monitor is due when its interval has elapsed since the start of the cycle
 * that last checked it. `lastCheckedAt` is stamped with the cycle start (not
 * when the slowest check finished), so cycle duration never delays the next one.
 */
export function isMonitorDue(
  monitor: { lastCheckedAt: Date | null; interval: number },
  cycleStartedAt: number
): boolean {
  if (!monitor.lastCheckedAt) return true;
  const elapsed = cycleStartedAt - monitor.lastCheckedAt.getTime();
  return elapsed >= monitor.interval * 1000 - DUE_GRACE_MS;
}
