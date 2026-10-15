import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getSchedulerJobStates, isSchedulerRunning } from "@/lib/scheduler";

const MIN_STALE_MS = 3 * 60_000;
const DAILY_STALE_MS = 26 * 60 * 60_000;

type JobStatus = "healthy" | "running" | "stale" | "unknown";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const now = Date.now();
  const dbStart = Date.now();
  const [
    monitors,
    lastCheck,
    ssl,
    cleanupSetting,
    errors,
    pendingAlerts,
    openIncidents,
    checks5m,
    failed5m,
    recentEvents,
  ] = await Promise.all([
    prisma.monitor.findMany({
      where: { active: true },
      select: { interval: true, lastCheckedAt: true },
    }),
    prisma.monitor.aggregate({
      where: { active: true },
      _max: { lastCheckedAt: true },
    }),
    prisma.monitor.aggregate({
      where: { active: true },
      _max: { sslLastCheckedAt: true },
    }),
    prisma.appSetting.findUnique({ where: { key: "lastCleanupAt" } }),
    prisma.debugLog.groupBy({
      by: ["type"],
      where: {
        type: { in: ["ssl_error", "cleanup_error"] },
        createdAt: { gte: new Date(now - 24 * 60 * 60_000) },
      },
      _count: true,
    }),
    prisma.alertEvent.count({ where: { status: "pending" } }),
    prisma.incident.count({ where: { resolvedAt: null } }),
    prisma.check.count({ where: { checkedAt: { gte: new Date(now - 5 * 60_000) } } }),
    prisma.check.count({
      where: { checkedAt: { gte: new Date(now - 5 * 60_000) }, isUp: false },
    }),
    prisma.debugLog.findMany({
      where: {
        type: { in: ["scheduler_started", "cleanup", "ssl_error", "cleanup_error"] },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, message: true, createdAt: true },
    }),
  ]);
  const dbLatencyMs = Date.now() - dbStart;

  const { jobs: live, startedAt } = getSchedulerJobStates();
  const dueNow = monitors.filter(
    (m) => !m.lastCheckedAt || now - m.lastCheckedAt.getTime() >= m.interval * 1000
  );
  const maxOverdueMs = dueNow.reduce(
    (max, m) =>
      Math.max(
        max,
        m.lastCheckedAt ? now - m.lastCheckedAt.getTime() - m.interval * 1000 : 0
      ),
    0
  );
  const fastestInterval = monitors.reduce(
    (min, m) => Math.min(min, m.interval),
    Infinity
  );
  const checkStaleMs = Math.max(
    MIN_STALE_MS,
    (Number.isFinite(fastestInterval) ? fastestInterval : 60) * 2 * 1000 + 60_000
  );

  const errorCount = (type: string) =>
    errors.find((e) => e.type === type)?._count ?? 0;

  const build = (
    key: "check" | "ssl" | "cleanup",
    name: string,
    dbLast: Date | null,
    staleMs: number,
    errors24h: number
  ) => {
    const state = live[key];
    const lastRunMs = Math.max(
      dbLast?.getTime() ?? 0,
      state.lastFinishedAt ?? 0
    );
    const lastRunAt = lastRunMs ? lastRunMs : null;
    const status: JobStatus = state.running
      ? "running"
      : !lastRunAt
        ? "unknown"
        : now - lastRunAt > staleMs
          ? "stale"
          : "healthy";
    return {
      key,
      name,
      status,
      intervalMs: state.intervalMs,
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      nextRunAt: state.nextRunAt ? new Date(state.nextRunAt).toISOString() : null,
      lastDurationMs: state.lastDurationMs,
      lastError: state.lastError,
      runs: state.runs,
      failures: state.failures,
      errors24h,
    };
  };

  return NextResponse.json({
    now: new Date(now).toISOString(),
    running: isSchedulerRunning(),
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    jobs: [
      build("check", "Monitor checks", lastCheck._max.lastCheckedAt, checkStaleMs, 0),
      build("ssl", "SSL check", ssl._max.sslLastCheckedAt, DAILY_STALE_MS, errorCount("ssl_error")),
      build(
        "cleanup",
        "Cleanup",
        cleanupSetting ? new Date(cleanupSetting.value) : null,
        DAILY_STALE_MS,
        errorCount("cleanup_error")
      ),
    ],
    stats: {
      activeMonitors: monitors.length,
      dueNow: dueNow.length,
      maxOverdueMs,
      checks5m,
      failed5m,
      pendingAlerts,
      openIncidents,
      dbLatencyMs,
    },
    events: recentEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  });
}
