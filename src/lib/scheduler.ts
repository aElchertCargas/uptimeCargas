import { writeDebugLog } from "@/lib/notifications";
import { withAdvisoryLock } from "@/lib/postgres-lock";
import { runCleanupCycle } from "@/lib/run-cleanup";
import { runSslCheckCycle } from "@/lib/run-ssl-check";

export type SchedulerJobName = "check" | "ssl" | "cleanup";

export interface SchedulerJobState {
  intervalMs: number;
  nextRunAt: number | null;
  running: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
  failures: number;
}

// Shared via globalThis so API routes see the same state as the scheduler
// even when Next bundles them as separate modules.
const globalState = globalThis as unknown as {
  __schedulerJobs?: Record<SchedulerJobName, SchedulerJobState>;
  __schedulerStartedAt?: number | null;
};

function newJobState(intervalMs: number): SchedulerJobState {
  return {
    intervalMs,
    nextRunAt: null,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastError: null,
    runs: 0,
    failures: 0,
  };
}

const jobStates: Record<SchedulerJobName, SchedulerJobState> =
  (globalState.__schedulerJobs ??= {
    check: newJobState(60_000),
    ssl: newJobState(24 * 60 * 60 * 1000),
    cleanup: newJobState(24 * 60 * 60 * 1000),
  });

export function getSchedulerJobStates() {
  return {
    jobs: jobStates,
    startedAt: globalState.__schedulerStartedAt ?? null,
  };
}

async function tracked(
  name: SchedulerJobName,
  fn: () => Promise<string | void>
) {
  const state = jobStates[name];
  state.running = true;
  state.lastStartedAt = Date.now();
  state.nextRunAt = state.lastStartedAt + state.intervalMs;
  try {
    const error = await fn();
    state.lastError = error ?? null;
    if (error) state.failures++;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    state.failures++;
  } finally {
    state.running = false;
    state.runs++;
    state.lastFinishedAt = Date.now();
    state.lastDurationMs = state.lastFinishedAt - state.lastStartedAt;
  }
}

let schedulerRunning = false;
let checkIntervalId: ReturnType<typeof setInterval> | null = null;
let sslIntervalId: ReturnType<typeof setInterval> | null = null;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let checkStartupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let sslStartupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let cleanupStartupTimeoutId: ReturnType<typeof setTimeout> | null = null;

const CHECK_INTERVAL_MS = 60_000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_STARTUP_DELAY_MS = 5_000;
const SSL_STARTUP_DELAY_MS = 15_000;
const CLEANUP_STARTUP_DELAY_MS = 30_000;

function getBaseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

async function runCheckCycle() {
  await tracked("check", async () => {
    try {
      const res = await fetch(`${getBaseUrl()}/api/cron/check`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ""}` },
      });
      if (!res.ok) return `Check endpoint returned ${res.status}`;
    } catch (error) {
      // Retry next cycle
      return error instanceof Error ? error.message : "Check request failed";
    }
  });
}

async function runInternalSslCycle() {
  await tracked("ssl", runSslCycleBody);
}

async function runInternalCleanupCycle() {
  await tracked("cleanup", runCleanupCycleBody);
}

async function runSslCycleBody(): Promise<string | void> {
  try {
    const lockResult = await withAdvisoryLock(4214003, runSslCheckCycle);
    if (!lockResult.acquired || !lockResult.result) return;
    const result = lockResult.result;
    console.log(
      `[scheduler] SSL check completed: checked=${result.checked} alerted=${result.alerted} total=${result.total}`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown SSL scheduler error";
    console.error(`[scheduler] SSL check failed: ${message}`);
    await writeDebugLog("ssl_error", "scheduler", null, message).catch(() => {});
    return message;
  }
}

async function runCleanupCycleBody(): Promise<string | void> {
  try {
    const lockResult = await withAdvisoryLock(4214004, runCleanupCycle);
    if (!lockResult.acquired || !lockResult.result) return;
    const result = lockResult.result;
    console.log(
      `[scheduler] Cleanup completed: deleted=${result.deleted} retentionDays=${result.retentionDays}`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown cleanup scheduler error";
    console.error(`[scheduler] Cleanup failed: ${message}`);
    await writeDebugLog("cleanup_error", "scheduler", null, message).catch(
      () => {}
    );
    return message;
  }
}

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  globalState.__schedulerStartedAt = Date.now();
  jobStates.check.nextRunAt = Date.now() + CHECK_STARTUP_DELAY_MS;
  jobStates.ssl.nextRunAt = Date.now() + SSL_STARTUP_DELAY_MS;
  jobStates.cleanup.nextRunAt = Date.now() + CLEANUP_STARTUP_DELAY_MS;

  // Keep the main monitor loop inside the always-on Railway web instance.
  checkStartupTimeoutId = setTimeout(runCheckCycle, CHECK_STARTUP_DELAY_MS);
  sslStartupTimeoutId = setTimeout(runInternalSslCycle, SSL_STARTUP_DELAY_MS);
  cleanupStartupTimeoutId = setTimeout(
    runInternalCleanupCycle,
    CLEANUP_STARTUP_DELAY_MS
  );

  checkIntervalId = setInterval(runCheckCycle, CHECK_INTERVAL_MS);
  sslIntervalId = setInterval(runInternalSslCycle, DAILY_INTERVAL_MS);
  cleanupIntervalId = setInterval(runInternalCleanupCycle, DAILY_INTERVAL_MS);

  console.log(
    `[scheduler] Started internal jobs: checks every ${CHECK_INTERVAL_MS / 1000}s, SSL every ${DAILY_INTERVAL_MS / 86_400_000}d, cleanup every ${DAILY_INTERVAL_MS / 86_400_000}d`
  );
  void writeDebugLog(
    "scheduler_started",
    "scheduler",
    null,
    `Checks every ${CHECK_INTERVAL_MS / 1000}s, SSL every 24h, cleanup every 24h`
  ).catch(() => {});
}

export function stopScheduler() {
  if (checkIntervalId) clearInterval(checkIntervalId);
  if (sslIntervalId) clearInterval(sslIntervalId);
  if (cleanupIntervalId) clearInterval(cleanupIntervalId);
  if (checkStartupTimeoutId) clearTimeout(checkStartupTimeoutId);
  if (sslStartupTimeoutId) clearTimeout(sslStartupTimeoutId);
  if (cleanupStartupTimeoutId) clearTimeout(cleanupStartupTimeoutId);
  checkIntervalId = null;
  sslIntervalId = null;
  cleanupIntervalId = null;
  checkStartupTimeoutId = null;
  sslStartupTimeoutId = null;
  cleanupStartupTimeoutId = null;
  schedulerRunning = false;
}

export function isSchedulerRunning() {
  return schedulerRunning;
}
