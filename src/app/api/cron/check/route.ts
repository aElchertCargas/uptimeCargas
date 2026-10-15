import { NextRequest, NextResponse } from "next/server";
import {
  createZendeskTicketsForLongRunningIncidents,
  dispatchPendingAlertEvents,
  getZendeskSettings,
  protectDownTransitionsForIncidentCreation,
  queueDueDownAlertEvents,
  recordDownTransitions,
  resolveOrphanedIncidents,
  resolveRecoveryTransitions,
  type MonitorStateTransition,
} from "@/lib/alerting";
import { saveCheckResults, type CheckRecord } from "@/lib/check-results";
import { performCheck, runChecksInBatches } from "@/lib/checker";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { isMonitorDue } from "@/lib/monitor-schedule";
import { withAdvisoryLock } from "@/lib/postgres-lock";
import { prisma } from "@/lib/prisma";

export const maxDuration = 120;
const CHECK_CYCLE_LOCK_ID = 4214001;

export async function POST(request: NextRequest) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockResult = await withAdvisoryLock(CHECK_CYCLE_LOCK_ID, async () => {
    const monitors = await prisma.monitor.findMany({
      where: { active: true },
    });

    const cycleStartedAt = new Date();
    const dueMonitors = monitors.filter((monitor) =>
      isMonitorDue(monitor, cycleStartedAt.getTime())
    );

    const pendingInserts: CheckRecord[] = [];
    const stateChanges: MonitorStateTransition<(typeof dueMonitors)[number]>[] = [];

    await runChecksInBatches(dueMonitors, async (monitor) => {
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
      clearSuppressionOnUp: true,
      checkedAt: cycleStartedAt,
    });

    const zendeskSettings = await getZendeskSettings();
    const downProtection = await protectDownTransitionsForIncidentCreation(
      "cron-check",
      dueMonitors.length,
      stateChanges
    );

    const resultByMonitorId = new Map(
      pendingInserts.map((record) => [record.monitorId, record])
    );
    const sustainedSuppressedTransitions = dueMonitors.flatMap((monitor) => {
      const record = resultByMonitorId.get(monitor.id);
      if (
        !record ||
        record.isUp ||
        !monitor.suppressedDownAt ||
        Date.now() - monitor.suppressedDownAt.getTime() < monitor.interval * 1000
      ) {
        return [];
      }
      return [{ monitor, result: record, previouslyUp: false }];
    });

    await recordDownTransitions([
      ...downProtection.downTransitionsForIncidents,
      ...sustainedSuppressedTransitions,
    ]);
    if (downProtection.suppression.suppressed) {
      await Promise.all(
        stateChanges
          .filter((transition) => !transition.result.isUp)
          .map((transition) =>
            prisma.monitor.update({
              where: { id: transition.monitor.id },
              data: {
                suppressedDownAt: new Date(),
                suppressedDownMessage: transition.result.message,
              },
            })
          )
      );
    }
    await resolveRecoveryTransitions(stateChanges, zendeskSettings, true);

    const recoveredMonitorIds = new Set(
      stateChanges
        .filter((transition) => transition.result.isUp)
        .map((transition) => transition.monitor.id)
    );
    await resolveOrphanedIncidents(zendeskSettings, recoveredMonitorIds);

    const queuedDown = await queueDueDownAlertEvents(new Date());
    const alertDispatch = await dispatchPendingAlertEvents(new Date());
    const zendeskTicketsCreated = await createZendeskTicketsForLongRunningIncidents(
      new Date(),
      zendeskSettings
    );

    return {
      checked: pendingInserts.length,
      queuedDown,
      alertsProcessed: alertDispatch.processed,
      alertsSent: alertDispatch.sent,
      zendeskTicketsCreated,
      suppression: downProtection.suppression,
      results: pendingInserts.map((record) => ({
        monitorId: record.monitorId,
        isUp: record.isUp,
        changed: stateChanges.some(
          (transition) => transition.monitor.id === record.monitorId
        ),
      })),
    };
  });

  if (!lockResult.acquired) {
    return NextResponse.json(
      {
        skipped: true,
        reason: "Another check cycle is already running.",
      },
      { status: 202 }
    );
  }

  return NextResponse.json(lockResult.result);
}
