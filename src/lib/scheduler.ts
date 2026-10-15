import { CHECK_INTERVAL_MS } from "@/lib/monitor-schedule";
import { writeDebugLog } from "@/lib/notifications";
import { withAdvisoryLock } from "@/lib/postgres-lock";
import { runCleanupCycle } from "@/lib/run-cleanup";
import { runSslCheckCycle } from "@/lib/run-ssl-check";

let schedulerRunning = false;
let checkIntervalId: ReturnType<typeof setInterval> | null = null;
let sslIntervalId: ReturnType<typeof setInterval> | null = null;
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let checkStartupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let sslStartupTimeoutId: ReturnType<typeof setTimeout> | null = null;
let cleanupStartupTimeoutId: ReturnType<typeof setTimeout> | null = null;

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_STARTUP_DELAY_MS = 5_000;
const SSL_STARTUP_DELAY_MS = 15_000;
const CLEANUP_STARTUP_DELAY_MS = 30_000;

function getBaseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

async function runCheckCycle() {
  try {
    await fetch(`${getBaseUrl()}/api/cron/check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ""}` },
    });
  } catch {
    // Retry next cycle
  }
}

async function runInternalSslCycle() {
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
  }
}

async function runInternalCleanupCycle() {
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
  }
}

export function startScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

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
