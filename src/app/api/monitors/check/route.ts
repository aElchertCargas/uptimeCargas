import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import {
  dispatchPendingAlertEvents,
  getZendeskSettings,
  protectDownTransitionsForIncidentCreation,
  queueDueDownAlertEvents,
  recordDownTransitions,
  resolveRecoveryTransitions,
  type MonitorStateTransition,
} from "@/lib/alerting";
import { saveCheckResults, type CheckRecord } from "@/lib/check-results";
import { prisma } from "@/lib/prisma";
import { performCheck, runChecksInBatches } from "@/lib/checker";
import { withAdvisoryLock } from "@/lib/postgres-lock";

export const maxDuration = 120;

async function runManualCheck(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const body = await request.json();
  const monitorIds: string[] = body.monitorIds;
  const sendAlerts = body.sendAlerts === true;

  if (!Array.isArray(monitorIds) || monitorIds.length === 0) {
    return NextResponse.json(
      { error: "monitorIds must be a non-empty array" },
      { status: 400 }
    );
  }

  const startedAt = new Date();
  const monitors = await prisma.monitor.findMany({
    where: { id: { in: monitorIds } },
  });

  const pendingInserts: CheckRecord[] = [];
  const stateChanges: MonitorStateTransition<(typeof monitors)[number]>[] = [];

  await runChecksInBatches(monitors, async (monitor) => {
    const result = await performCheck(
      monitor.url,
      monitor.method,
      monitor.timeout,
      monitor.expectedStatus,
      monitor.maxRetries
    );

    pendingInserts.push({
      monitorId: monitor.id,
      status: result.status,
      responseTime: result.responseTime,
      isUp: result.isUp,
      message: result.message,
    });

    const previouslyUp = monitor.lastStatus ?? true;
    if (previouslyUp !== result.isUp) {
      stateChanges.push({ monitor, result, previouslyUp });
    }
  });

  await saveCheckResults(pendingInserts, {
    clearSuppressionOnUp: false,
    checkedAt: startedAt,
  });

  const zendeskSettings = await getZendeskSettings();
  const downProtection = await protectDownTransitionsForIncidentCreation(
    "manual-check",
    monitors.length,
    stateChanges
  );

  await recordDownTransitions(downProtection.downTransitionsForIncidents);

  if (sendAlerts) {
    await queueDueDownAlertEvents(new Date());
  }
  await resolveRecoveryTransitions(stateChanges, zendeskSettings, sendAlerts);

  let alertsProcessed = 0;
  let alertsSent = 0;
  if (sendAlerts) {
    const dispatchSummary = await dispatchPendingAlertEvents(new Date());
    alertsProcessed = dispatchSummary.processed;
    alertsSent = dispatchSummary.sent;
  }

  return NextResponse.json({
    checked: pendingInserts.length,
    sendAlerts,
    alertsProcessed,
    alertsSent,
    suppression: downProtection.suppression,
    results: pendingInserts.map((r) => ({
      monitorId: r.monitorId,
      isUp: r.isUp,
      changed: stateChanges.some((sc) => sc.monitor.id === r.monitorId),
    })),
  });
}

export async function POST(request: NextRequest) {
  const lockResult = await withAdvisoryLock(4214002, () => runManualCheck(request));
  if (!lockResult.acquired) {
    return NextResponse.json(
      { error: "Another check cycle is already running." },
      { status: 409 }
    );
  }
  return lockResult.result ?? NextResponse.json(
    { error: "Check cycle did not produce a response." },
    { status: 500 }
  );
}
