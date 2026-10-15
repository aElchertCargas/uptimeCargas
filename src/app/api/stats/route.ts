import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const monitors = await prisma.monitor.findMany({
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
    },
    orderBy: { name: "asc" },
  });

  const enriched = monitors.map((m) => ({
    id: m.id,
    name: m.name,
    url: m.url,
    active: m.active,
    interval: m.interval,
    tags: m.tags,
    latestCheck: m.lastCheckedAt
      ? {
          status: 0,
          responseTime: m.lastResponseTime ?? 0,
          isUp: m.lastStatus ?? false,
          message: null,
          checkedAt: m.lastCheckedAt.toISOString(),
        }
      : null,
    uptime24h: m.uptime24h,
    avgResponseTime: m.avgResponseTime24h,
    totalChecks24h: 0,
  }));

  const totalMonitors = monitors.length;
  const activeMonitors = monitors.filter((m) => m.active).length;
  const upMonitors = monitors.filter((m) => m.lastStatus === true).length;
  const downMonitors = monitors.filter(
    (m) => m.active && m.lastStatus === false
  ).length;

  return NextResponse.json({
    summary: {
      total: totalMonitors,
      active: activeMonitors,
      up: upMonitors,
      down: downMonitors,
    },
    monitors: enriched,
  });
}
