import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

// The recent-checks strip covers the last hour in two-minute slots.
const HISTORY_WINDOW_MS = 60 * 60 * 1000;
const HISTORY_SLOTS = 30;
const SLOT_MS = HISTORY_WINDOW_MS / HISTORY_SLOTS;
const EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 10;

type SlotState = "up" | "down" | "none";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const now = Date.now();
  const historySince = new Date(now - HISTORY_WINDOW_MS);
  const eventsSince = new Date(now - EVENT_WINDOW_MS);

  const [monitors, recentChecks, openIncidents, recentIncidents] =
    await Promise.all([
      prisma.monitor.findMany({
        select: {
          id: true,
          name: true,
          url: true,
          active: true,
          interval: true,
          tags: true,
          lastStatus: true,
          lastResponseTime: true,
          lastCheckedAt: true,
          uptime24h: true,
          avgResponseTime24h: true,
          suppressedDownAt: true,
          suppressedDownMessage: true,
          sslExpiresAt: true,
        },
        orderBy: { name: "asc" },
      }),
      prisma.check.findMany({
        where: { checkedAt: { gte: historySince } },
        select: { monitorId: true, isUp: true, checkedAt: true },
      }),
      prisma.incident.findMany({
        where: { resolvedAt: null },
        select: { monitorId: true, startedAt: true, message: true },
        orderBy: { startedAt: "asc" },
      }),
      prisma.incident.findMany({
        where: {
          OR: [
            { startedAt: { gte: eventsSince } },
            { resolvedAt: { gte: eventsSince } },
          ],
        },
        select: {
          id: true,
          startedAt: true,
          resolvedAt: true,
          message: true,
          monitor: { select: { id: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
        take: MAX_EVENTS * 2,
      }),
    ]);

  // A slot is down if any check in it failed, up if all passed.
  const history = new Map<string, SlotState[]>();
  for (const check of recentChecks) {
    const slot = Math.floor(
      (check.checkedAt.getTime() - historySince.getTime()) / SLOT_MS
    );
    if (slot < 0 || slot >= HISTORY_SLOTS) continue;
    let slots = history.get(check.monitorId);
    if (!slots) {
      slots = Array<SlotState>(HISTORY_SLOTS).fill("none");
      history.set(check.monitorId, slots);
    }
    if (!check.isUp) slots[slot] = "down";
    else if (slots[slot] === "none") slots[slot] = "up";
  }

  // Keep the earliest open incident per monitor.
  const openIncidentByMonitor = new Map<
    string,
    { startedAt: Date; message: string | null }
  >();
  for (const incident of openIncidents) {
    if (!openIncidentByMonitor.has(incident.monitorId)) {
      openIncidentByMonitor.set(incident.monitorId, incident);
    }
  }

  const enriched = monitors.map((m) => {
    const incident = openIncidentByMonitor.get(m.id);
    return {
      id: m.id,
      name: m.name,
      url: m.url,
      active: m.active,
      interval: m.interval,
      tags: m.tags,
      lastStatus: m.lastStatus,
      lastResponseTime: m.lastResponseTime,
      lastCheckedAt: m.lastCheckedAt?.toISOString() ?? null,
      uptime24h: m.uptime24h,
      avgResponseTime: m.avgResponseTime24h,
      sslExpiresAt: m.sslExpiresAt?.toISOString() ?? null,
      suppressedDownAt: m.suppressedDownAt?.toISOString() ?? null,
      suppressedDownMessage: m.suppressedDownMessage,
      downSince: incident?.startedAt.toISOString() ?? null,
      downMessage: incident?.message ?? null,
      history: history.get(m.id) ?? Array<SlotState>(HISTORY_SLOTS).fill("none"),
    };
  });

  const events = recentIncidents
    .flatMap((incident) => {
      const items = [];
      if (incident.startedAt >= eventsSince) {
        items.push({
          id: `${incident.id}:down`,
          kind: "down" as const,
          monitorId: incident.monitor.id,
          monitorName: incident.monitor.name,
          message: incident.message,
          at: incident.startedAt.toISOString(),
        });
      }
      if (incident.resolvedAt && incident.resolvedAt >= eventsSince) {
        items.push({
          id: `${incident.id}:up`,
          kind: "up" as const,
          monitorId: incident.monitor.id,
          monitorName: incident.monitor.name,
          message: null,
          durationMs:
            incident.resolvedAt.getTime() - incident.startedAt.getTime(),
          at: incident.resolvedAt.toISOString(),
        });
      }
      return items;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_EVENTS);

  const active = monitors.filter((m) => m.active);
  const lastCycleAt = monitors.reduce<Date | null>(
    (latest, m) =>
      m.lastCheckedAt && (!latest || m.lastCheckedAt > latest)
        ? m.lastCheckedAt
        : latest,
    null
  );

  return NextResponse.json({
    summary: {
      total: monitors.length,
      active: active.length,
      up: active.filter((m) => m.lastStatus === true).length,
      down: active.filter((m) => m.lastStatus === false).length,
      paused: monitors.length - active.length,
      lastCycleAt: lastCycleAt?.toISOString() ?? null,
    },
    monitors: enriched,
    events,
  });
}
