import type { Prisma } from "@/generated/prisma/client";
import type { CheckResult } from "@/lib/checker";
import {
  buildRecoveryNotificationPayload,
  dispatchNotificationDetailed,
  type NotificationPayload,
  type NotificationZendeskMetadata,
  writeDebugLog,
} from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  createZendeskTicket,
  getDefaultSslBodyTemplate,
  getDefaultSslSubjectTemplate,
  updateZendeskTicket,
} from "@/lib/zendesk";

const ALERT_KIND_DOWN = "down";
const ALERT_KIND_UP = "up";

const ALERT_STATUS_PENDING = "pending";
const ALERT_STATUS_PROCESSING = "processing";
const ALERT_STATUS_SENT = "sent";
const ALERT_STATUS_FAILED = "failed";
const ALERT_STATUS_ABANDONED = "abandoned";
const FALSE_DOWN_PROTECTION_DEFAULTS = {
  enabled: true,
  minAffectedMonitors: 8,
  minAffectedRatio: 0.2,
  minNetworkErrorRatio: 0.75,
} as const;
const NETWORK_STYLE_FAILURE_PATTERNS = [
  /fetch failed/i,
  /timeout/i,
  /timed out/i,
  /econnreset/i,
  /econnrefused/i,
  /ehostunreach/i,
  /enotfound/i,
  /network/i,
  /socket/i,
  /tls/i,
] as const;

type AlertKind = typeof ALERT_KIND_DOWN | typeof ALERT_KIND_UP;

type AlertEventWithIncident = Prisma.AlertEventGetPayload<{
  include: {
    deliveries: true;
    incident: {
      include: {
        monitor: true;
        alertEvents: {
          include: {
            deliveries: true;
          };
        };
      };
    };
  };
}>;

type IncidentWithAlertState = Prisma.IncidentGetPayload<{
  include: {
    monitor: true;
    alertEvents: {
      include: {
        deliveries: true;
      };
    };
  };
}>;

type OrphanIncident = Prisma.IncidentGetPayload<{
  include: {
    monitor: {
      include: {
        checks: {
          orderBy: {
            checkedAt: "desc";
          };
          take: 1;
        };
      };
    };
    alertEvents: {
      include: {
        deliveries: true;
      };
    };
  };
}>;

export interface ZendeskSettings {
  enabled: boolean;
  subdomain: string;
  email: string;
  apiToken: string;
  groupId: string;
  delayMinutes: number;
  sslAlertsEnabled: boolean;
  subjectTemplate: string;
  bodyTemplate: string;
}

export interface ZendeskSslTicketInput {
  monitorName: string;
  monitorUrl: string;
  message: string;
  timestamp: string;
  daysRemaining: number;
  expiresAt: Date;
  issuer: string;
}

export interface AlertingMonitor {
  id: string;
  name: string;
  url: string;
}

export interface MonitorStateTransition<TMonitor extends AlertingMonitor = AlertingMonitor> {
  monitor: TMonitor;
  result: CheckResult;
  previouslyUp: boolean;
}

interface ResolveRecoveryOptions {
  emitAlerts: boolean;
  zendeskSettings: ZendeskSettings;
  reason: string;
}

export interface FalseDownProtectionSettings {
  enabled: boolean;
  minAffectedMonitors: number;
  minAffectedRatio: number;
  minNetworkErrorRatio: number;
}

export interface FalseDownSuppressionSummary {
  enabled: boolean;
  suppressed: boolean;
  checkedMonitors: number;
  downTransitions: number;
  networkStyleDownTransitions: number;
  suppressedDownTransitions: number;
  allowedDownTransitions: number;
  affectedRatio: number;
  networkErrorRatio: number;
  reason: string | null;
}

export interface FalseDownProtectionResult<
  TMonitor extends AlertingMonitor = AlertingMonitor,
> {
  downTransitionsForIncidents: MonitorStateTransition<TMonitor>[];
  suppression: FalseDownSuppressionSummary;
}

type ZendeskRecoveryUpdateResult =
  | "updated"
  | "failed"
  | "skipped_no_ticket"
  | "skipped_no_config";

function parseResponseTimeMs(
  eventContext: Prisma.JsonValue | null | undefined
): number {
  if (
    eventContext &&
    typeof eventContext === "object" &&
    !Array.isArray(eventContext) &&
    "responseTimeMs" in eventContext
  ) {
    const responseTimeMs = eventContext.responseTimeMs;
    if (typeof responseTimeMs === "number") {
      return responseTimeMs;
    }
  }

  return 0;
}

function buildDownNotificationPayload(
  incident: IncidentWithAlertState
): NotificationPayload {
  return {
    monitorName: incident.monitor.name,
    monitorUrl: incident.monitor.url,
    status: "down",
    message: `${incident.monitor.name} is DOWN: ${incident.message ?? "Unknown error"}`,
    timestamp: incident.startedAt.toISOString(),
  };
}

function buildZendeskTicketUrl(subdomain: string, ticketId: string): string {
  return `https://${subdomain}.zendesk.com/agent/tickets/${ticketId}`;
}

function buildRecoveryZendeskMetadata(
  incident: Pick<IncidentWithAlertState, "zendeskTicketId" | "zendeskRecoveryStatus">,
  zendeskSubdomain: string
): NotificationZendeskMetadata {
  const updated = incident.zendeskRecoveryStatus === "updated";

  return {
    url: incident.zendeskTicketId && zendeskSubdomain
      ? buildZendeskTicketUrl(zendeskSubdomain, incident.zendeskTicketId)
      : null,
    display: `Zendesk: ${updated ? "✅" : "❌"}`,
    updated,
  };
}

function buildAlertPayload(
  event: AlertEventWithIncident,
  zendeskSubdomain: string
): NotificationPayload {
  const kind = event.kind as AlertKind;

  switch (kind) {
    case ALERT_KIND_DOWN:
      return buildDownNotificationPayload(event.incident);
    case ALERT_KIND_UP:
      return buildRecoveryNotificationPayload({
        monitorName: event.incident.monitor.name,
        monitorUrl: event.incident.monitor.url,
        responseTimeMs: parseResponseTimeMs(event.context),
        incidentMessage: event.incident.message,
        startedAt: event.incident.startedAt,
        resolvedAt: event.incident.resolvedAt ?? event.scheduledFor,
        zendesk: buildRecoveryZendeskMetadata(event.incident, zendeskSubdomain),
      });
    default: {
      const exhaustiveCheck: never = kind;
      return {
        monitorName: event.incident.monitor.name,
        monitorUrl: event.incident.monitor.url,
        status: "up",
        message: `${event.incident.monitor.name} alert event could not be rendered (${exhaustiveCheck})`,
        timestamp: event.scheduledFor.toISOString(),
      };
    }
  }
}

async function getTargetChannels(event: AlertEventWithIncident) {
  if (event.kind === ALERT_KIND_DOWN) {
    return prisma.notificationChannel.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" },
    });
  }

  const downEvent = await prisma.alertEvent.findUnique({
    where: {
      incidentId_kind: {
        incidentId: event.incidentId,
        kind: ALERT_KIND_DOWN,
      },
    },
    include: {
      deliveries: true,
    },
  });
  const sentChannelIds =
    downEvent?.deliveries
      .filter((delivery) => delivery.sentAt !== null)
      .map((delivery) => delivery.channelId) ?? [];

  if (sentChannelIds.length === 0) {
    return [];
  }

  return prisma.notificationChannel.findMany({
    where: {
      enabled: true,
      id: { in: sentChannelIds },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function addZendeskRecoveryUpdate(
  incident: IncidentWithAlertState,
  zendeskSettings: ZendeskSettings,
  resolvedAt: Date,
  responseTimeMs: number
) : Promise<ZendeskRecoveryUpdateResult> {
  if (!hasZendeskConfig(zendeskSettings)) {
    return "skipped_no_config";
  }

  if (!incident.zendeskTicketId) {
    await writeDebugLog(
      "zendesk_ticket",
      incident.monitor.name,
      "zendesk",
      "Recovery detected, but no Zendesk ticket exists for this incident."
    ).catch(() => {});
    return "skipped_no_ticket";
  }

  const downtimeMinutes = Math.max(
    1,
    Math.round((resolvedAt.getTime() - incident.startedAt.getTime()) / 60000)
  );

  const updated = await updateZendeskTicket(
    {
      subdomain: zendeskSettings.subdomain,
      email: zendeskSettings.email,
      apiToken: zendeskSettings.apiToken,
      groupId: zendeskSettings.groupId,
    },
    incident.zendeskTicketId,
    {
      monitorName: incident.monitor.name,
      monitorUrl: incident.monitor.url,
      message: incident.message ?? "No error details available",
      downTimestamp: incident.startedAt.toISOString(),
      recoveredTimestamp: resolvedAt.toISOString(),
      downtimeMinutes,
      responseTimeMs,
    }
  );

  const ticketUrl = buildZendeskTicketUrl(
    zendeskSettings.subdomain,
    incident.zendeskTicketId
  );
  await writeDebugLog(
    updated ? "zendesk_ticket" : "zendesk_ticket_failed",
    incident.monitor.name,
    "zendesk",
    updated
      ? `Zendesk ticket #${incident.zendeskTicketId} updated with recovery note — ${ticketUrl}`
      : `Failed to update Zendesk ticket #${incident.zendeskTicketId} with recovery note — ${ticketUrl}`
  ).catch(() => {});

  return updated ? "updated" : "failed";
}

async function finalizeRecovery(
  incident: IncidentWithAlertState,
  resolvedAt: Date,
  responseTimeMs: number,
  options: ResolveRecoveryOptions
) {
  const updateResult = await prisma.incident.updateMany({
    where: { id: incident.id, resolvedAt: null },
    data: { resolvedAt },
  });

  if (updateResult.count === 0) {
    return false;
  }

  const zendeskRecoveryStatus = await addZendeskRecoveryUpdate(
    incident,
    options.zendeskSettings,
    resolvedAt,
    responseTimeMs
  );

  await prisma.incident.update({
    where: { id: incident.id },
    data: { zendeskRecoveryStatus },
  });

  await writeDebugLog("up", incident.monitor.name, null, options.reason);

  if (!options.emitAlerts) {
    return true;
  }

  const downEvent = incident.alertEvents.find((event) => event.kind === ALERT_KIND_DOWN);
  if (!downEvent) {
    return true;
  }

  await prisma.alertEvent.updateMany({
    where: {
      incidentId: incident.id,
      kind: ALERT_KIND_DOWN,
      status: { in: [ALERT_STATUS_PENDING, ALERT_STATUS_FAILED] },
    },
    data: {
      status: ALERT_STATUS_ABANDONED,
      lastError: "Incident recovered before the DOWN alert was sent.",
    },
  });

  const existingUpEvent = await prisma.alertEvent.findUnique({
    where: {
      incidentId_kind: {
        incidentId: incident.id,
        kind: ALERT_KIND_UP,
      },
    },
  });

  if (!existingUpEvent) {
    await prisma.alertEvent.upsert({
      where: {
        incidentId_kind: {
          incidentId: incident.id,
          kind: ALERT_KIND_UP,
        },
      },
      update: {},
      create: {
          incidentId: incident.id,
          kind: ALERT_KIND_UP,
          status: ALERT_STATUS_PENDING,
          scheduledFor: resolvedAt,
          context: { responseTimeMs },
      },
    });
  }

  return true;
}

export async function getAlertDelay(): Promise<number> {
  const row = await prisma.appSetting.findUnique({
    where: { key: "alertDelaySeconds" },
  });
  return row ? parseInt(row.value, 10) || 300 : 300;
}

export async function getFalseDownProtectionSettings(): Promise<FalseDownProtectionSettings> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "falseDownProtectionEnabled",
          "falseDownProtectionMinAffectedMonitors",
          "falseDownProtectionMinAffectedRatio",
          "falseDownProtectionMinNetworkErrorRatio",
        ],
      },
    },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const minAffectedMonitors = parseInt(
    map.get("falseDownProtectionMinAffectedMonitors") ??
      String(FALSE_DOWN_PROTECTION_DEFAULTS.minAffectedMonitors),
    10
  );
  const minAffectedRatio = parseFloat(
    map.get("falseDownProtectionMinAffectedRatio") ??
      String(FALSE_DOWN_PROTECTION_DEFAULTS.minAffectedRatio)
  );
  const minNetworkErrorRatio = parseFloat(
    map.get("falseDownProtectionMinNetworkErrorRatio") ??
      String(FALSE_DOWN_PROTECTION_DEFAULTS.minNetworkErrorRatio)
  );

  return {
    enabled:
      (map.get("falseDownProtectionEnabled") ?? "true") !== "false",
    minAffectedMonitors:
      Number.isFinite(minAffectedMonitors) && minAffectedMonitors > 0
        ? minAffectedMonitors
        : FALSE_DOWN_PROTECTION_DEFAULTS.minAffectedMonitors,
    minAffectedRatio:
      Number.isFinite(minAffectedRatio) && minAffectedRatio > 0
        ? Math.min(minAffectedRatio, 1)
        : FALSE_DOWN_PROTECTION_DEFAULTS.minAffectedRatio,
    minNetworkErrorRatio:
      Number.isFinite(minNetworkErrorRatio) && minNetworkErrorRatio > 0
        ? Math.min(minNetworkErrorRatio, 1)
        : FALSE_DOWN_PROTECTION_DEFAULTS.minNetworkErrorRatio,
  };
}

export function isNetworkStyleFailure(
  result: Pick<CheckResult, "isUp" | "status" | "message">
): boolean {
  if (result.isUp) {
    return false;
  }

  if (result.status === 0) {
    return true;
  }

  const message = result.message ?? "";
  return NETWORK_STYLE_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

export function evaluateFalseDownProtection<
  TMonitor extends AlertingMonitor = AlertingMonitor,
>(
  checkedMonitors: number,
  transitions: MonitorStateTransition<TMonitor>[],
  settings: FalseDownProtectionSettings
): FalseDownProtectionResult<TMonitor> {
  const downTransitions = transitions.filter((transition) => !transition.result.isUp);
  const networkStyleDownTransitions = downTransitions.filter((transition) =>
    isNetworkStyleFailure(transition.result)
  );
  const affectedRatio =
    checkedMonitors > 0 ? downTransitions.length / checkedMonitors : 0;
  const networkErrorRatio =
    downTransitions.length > 0
      ? networkStyleDownTransitions.length / downTransitions.length
      : 0;

  let suppressedDownTransitions: MonitorStateTransition<TMonitor>[] = [];
  let reason: string | null = null;

  if (
    settings.enabled &&
    checkedMonitors >= settings.minAffectedMonitors &&
    downTransitions.length >= settings.minAffectedMonitors &&
    affectedRatio >= settings.minAffectedRatio &&
    networkErrorRatio >= settings.minNetworkErrorRatio
  ) {
    suppressedDownTransitions = networkStyleDownTransitions;
    reason =
      `Suppressed ${suppressedDownTransitions.length} network-style down transition(s) ` +
      `after ${checkedMonitors} checks; ${downTransitions.length} monitor(s) flipped down ` +
      `(${(affectedRatio * 100).toFixed(1)}%), ${(networkErrorRatio * 100).toFixed(1)}% ` +
      `of them matched a checker/network failure pattern.`;
  }

  const suppressedIds = new Set(
    suppressedDownTransitions.map((transition) => transition.monitor.id)
  );
  const downTransitionsForIncidents = downTransitions.filter(
    (transition) => !suppressedIds.has(transition.monitor.id)
  );

  return {
    downTransitionsForIncidents,
    suppression: {
      enabled: settings.enabled,
      suppressed: suppressedDownTransitions.length > 0,
      checkedMonitors,
      downTransitions: downTransitions.length,
      networkStyleDownTransitions: networkStyleDownTransitions.length,
      suppressedDownTransitions: suppressedDownTransitions.length,
      allowedDownTransitions: downTransitionsForIncidents.length,
      affectedRatio,
      networkErrorRatio,
      reason,
    },
  };
}

export async function protectDownTransitionsForIncidentCreation<
  TMonitor extends AlertingMonitor = AlertingMonitor,
>(
  source: string,
  checkedMonitors: number,
  transitions: MonitorStateTransition<TMonitor>[]
): Promise<FalseDownProtectionResult<TMonitor>> {
  const settings = await getFalseDownProtectionSettings();
  const result = evaluateFalseDownProtection(
    checkedMonitors,
    transitions,
    settings
  );

  if (result.suppression.suppressed && result.suppression.reason) {
    await writeDebugLog(
      "down_guard",
      "cycle-guard",
      null,
      `${source}: ${result.suppression.reason}`
    ).catch(() => {});
  }

  return result;
}

export async function getZendeskSettings(): Promise<ZendeskSettings> {
  const rows = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "zendeskEnabled",
          "zendeskSubdomain",
          "zendeskEmail",
          "zendeskApiToken",
          "zendeskGroupId",
          "zendeskTicketDelayMinutes",
          "zendeskSslAlertsEnabled",
          "zendeskSubjectTemplate",
          "zendeskBodyTemplate",
        ],
      },
    },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    enabled: map.get("zendeskEnabled") === "true",
    subdomain: map.get("zendeskSubdomain") ?? "",
    email: map.get("zendeskEmail") ?? "",
    apiToken: map.get("zendeskApiToken") ?? "",
    groupId: map.get("zendeskGroupId") ?? "",
    delayMinutes: parseInt(map.get("zendeskTicketDelayMinutes") ?? "30", 10) || 30,
    sslAlertsEnabled: map.get("zendeskSslAlertsEnabled") === "true",
    subjectTemplate:
      map.get("zendeskSubjectTemplate") ??
      "{{monitorName}} is DOWN ({{downtimeMinutes}} min)",
    bodyTemplate:
      map.get("zendeskBodyTemplate") ??
      "Monitor: {{monitorName}}\nURL: {{monitorUrl}}\nDown since: {{timestamp}}\nDuration: {{downtimeMinutes}} minutes\n\nError: {{message}}",
  };
}

export function hasZendeskConfig(settings: ZendeskSettings): boolean {
  return Boolean(
    settings.enabled &&
      settings.subdomain &&
      settings.email &&
      settings.apiToken &&
      settings.groupId
  );
}

export async function recordDownTransitions(
  transitions: MonitorStateTransition[]
) {
  for (const { monitor, result } of transitions) {
    if (result.isUp) {
      continue;
    }

    const existingOpen = await prisma.incident.findFirst({
      where: { monitorId: monitor.id, resolvedAt: null },
    });

    if (existingOpen) {
      continue;
    }

    try {
      await prisma.incident.create({
        data: { monitorId: monitor.id, message: result.message },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") {
        throw error;
      }
      continue;
    }

    await writeDebugLog(
      "down",
      monitor.name,
      null,
      result.message ?? "Monitor went down"
    );
  }
}

export async function queueDueDownAlertEvents(now: Date) {
  const alertDelay = await getAlertDelay();
  const cutoff = new Date(now.getTime() - alertDelay * 1000);

  const dueIncidents = await prisma.incident.findMany({
    where: {
      resolvedAt: null,
      startedAt: { lte: cutoff },
      alertEvents: {
        none: { kind: ALERT_KIND_DOWN },
      },
    },
  });

  for (const incident of dueIncidents) {
    await prisma.alertEvent.upsert({
      where: {
        incidentId_kind: {
          incidentId: incident.id,
          kind: ALERT_KIND_DOWN,
        },
      },
      update: {},
      create: {
          incidentId: incident.id,
          kind: ALERT_KIND_DOWN,
          status: ALERT_STATUS_PENDING,
          scheduledFor: cutoff,
      },
    });
  }

  return dueIncidents.length;
}

export async function resolveRecoveryTransitions(
  transitions: MonitorStateTransition[],
  zendeskSettings: ZendeskSettings,
  emitAlerts: boolean
) {
  for (const { monitor, result } of transitions) {
    if (!result.isUp) {
      continue;
    }

    const openIncident = await prisma.incident.findFirst({
      where: { monitorId: monitor.id, resolvedAt: null },
      orderBy: { startedAt: "desc" },
      include: {
        monitor: true,
        alertEvents: {
          include: {
            deliveries: true,
          },
        },
      },
    });

    if (!openIncident) {
      continue;
    }

    await finalizeRecovery(
      openIncident,
      new Date(),
      result.responseTime,
      {
        emitAlerts,
        zendeskSettings,
        reason: `${monitor.name} recovered (${result.responseTime}ms)`,
      }
    );
  }
}

export async function resolveOrphanedIncidents(
  zendeskSettings: ZendeskSettings,
  skipMonitorIds: Set<string>
) {
  const orphanedIncidents: OrphanIncident[] = await prisma.incident.findMany({
    where: { resolvedAt: null },
    include: {
      monitor: {
        include: {
          checks: {
            orderBy: { checkedAt: "desc" },
            take: 1,
          },
        },
      },
      alertEvents: {
        include: {
          deliveries: true,
        },
      },
    },
  });

  for (const incident of orphanedIncidents) {
    if (skipMonitorIds.has(incident.monitorId)) {
      continue;
    }

    const latestCheck = incident.monitor.checks[0];
    if (!latestCheck?.isUp) {
      continue;
    }

    await finalizeRecovery(
      incident,
      latestCheck.checkedAt,
      latestCheck.responseTime,
      {
        emitAlerts: true,
        zendeskSettings,
        reason: `${incident.monitor.name} recovered (orphaned incident resolved)`,
      }
    );
  }
}

export async function dispatchPendingAlertEvents(now: Date) {
  const zendeskSettings = await getZendeskSettings();
  const staleProcessingCutoff = new Date(now.getTime() - 5 * 60 * 1000);
  const events: AlertEventWithIncident[] = await prisma.alertEvent.findMany({
    where: {
      OR: [
        { status: { in: [ALERT_STATUS_PENDING, ALERT_STATUS_FAILED] } },
        { status: ALERT_STATUS_PROCESSING, processingAt: { lt: staleProcessingCutoff } },
      ],
      scheduledFor: { lte: now },
    },
    include: {
      deliveries: true,
      incident: {
        include: {
          monitor: true,
          alertEvents: {
            include: {
              deliveries: true,
            },
          },
        },
      },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
  });

  let processed = 0;
  let sent = 0;

  for (const event of events) {
    const claimResult = await prisma.alertEvent.updateMany({
      where: {
        id: event.id,
        OR: [
          { status: { in: [ALERT_STATUS_PENDING, ALERT_STATUS_FAILED] } },
          { status: ALERT_STATUS_PROCESSING, processingAt: { lt: staleProcessingCutoff } },
        ],
      },
      data: {
        status: ALERT_STATUS_PROCESSING,
        processingAt: now,
        lastError: null,
      },
    });

    if (claimResult.count === 0) {
      continue;
    }

    processed++;

    const targetChannels = await getTargetChannels(event);
    const isResolvedDownEvent =
      event.kind === ALERT_KIND_DOWN && event.incident.resolvedAt !== null;

    if (targetChannels.length === 0) {
      const noChannelStatus =
        event.kind === ALERT_KIND_UP || isResolvedDownEvent
          ? ALERT_STATUS_ABANDONED
          : ALERT_STATUS_FAILED;
      await prisma.alertEvent.update({
        where: { id: event.id },
        data: {
          status: noChannelStatus,
          processingAt: null,
          lastError: "No eligible notification channels for this alert event.",
        },
      });
      continue;
    }

    const payload = buildAlertPayload(event, zendeskSettings.subdomain);

    // Channels are independent, so one slow webhook shouldn't hold up the rest.
    await Promise.all(
      targetChannels.map(async (channel) => {
        const delivery = await prisma.alertDelivery.upsert({
          where: {
            alertEventId_channelId: {
              alertEventId: event.id,
              channelId: channel.id,
            },
          },
          update: {},
          create: {
            alertEventId: event.id,
            channelId: channel.id,
            status: ALERT_STATUS_PENDING,
          },
        });

        if (delivery.sentAt) {
          return;
        }

        const result = await dispatchNotificationDetailed(
          channel.type,
          channel.name,
          channel.config as Record<string, unknown>,
          payload
        );
        const attemptedAt = new Date();

        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: result.ok ? ALERT_STATUS_SENT : ALERT_STATUS_FAILED,
            attemptCount: { increment: 1 },
            attemptedAt,
            sentAt: result.ok ? attemptedAt : null,
            lastError: result.error,
          },
        });
      })
    );

    const refreshedDeliveries = await prisma.alertDelivery.findMany({
      where: {
        alertEventId: event.id,
        channelId: { in: targetChannels.map((channel) => channel.id) },
      },
    });

    const allSent =
      refreshedDeliveries.length === targetChannels.length &&
      refreshedDeliveries.every((delivery) => delivery.sentAt !== null);

    if (allSent) {
      const sentAt = new Date();
      await prisma.alertEvent.update({
        where: { id: event.id },
        data: {
          status: ALERT_STATUS_SENT,
          processingAt: null,
          sentAt,
          lastError: null,
        },
      });

      if (event.kind === ALERT_KIND_DOWN && event.incident.notifiedAt === null) {
        await prisma.incident.update({
          where: { id: event.incidentId },
          data: { notifiedAt: sentAt },
        });
      }

      sent++;
      continue;
    }

    const failedStatus = isResolvedDownEvent
      ? ALERT_STATUS_ABANDONED
      : ALERT_STATUS_FAILED;
    const failedMessage = isResolvedDownEvent
      ? "Incident recovered before every channel received the DOWN alert."
      : "One or more channel deliveries failed.";

    await prisma.alertEvent.update({
      where: { id: event.id },
      data: {
        status: failedStatus,
        processingAt: null,
        lastError: failedMessage,
      },
    });
  }

  return { processed, sent };
}

export async function createZendeskTicketsForLongRunningIncidents(
  now: Date,
  zendeskSettings: ZendeskSettings
) {
  if (!hasZendeskConfig(zendeskSettings)) {
    return 0;
  }

  const zendeskCutoff = new Date(
    now.getTime() - zendeskSettings.delayMinutes * 60 * 1000
  );
  const zendeskEnabledSetting = await prisma.appSetting.findUnique({
    where: { key: "zendeskEnabledAt" },
  });
  const zendeskEnabledAt = zendeskEnabledSetting
    ? new Date(zendeskEnabledSetting.value)
    : new Date(0);

  const unticketedIncidents = await prisma.incident.findMany({
    where: {
      resolvedAt: null,
      zendeskTicketId: null,
      startedAt: {
        lte: zendeskCutoff,
        gte: zendeskEnabledAt,
      },
    },
    include: { monitor: true },
  });

  let zendeskTicketsCreated = 0;

  for (const incident of unticketedIncidents) {
    const downtimeMinutes = Math.floor(
      (now.getTime() - incident.startedAt.getTime()) / 60000
    );
    const ticketId = await createZendeskTicket(
      {
        subdomain: zendeskSettings.subdomain,
        email: zendeskSettings.email,
        apiToken: zendeskSettings.apiToken,
        groupId: zendeskSettings.groupId,
      },
      zendeskSettings.subjectTemplate,
      zendeskSettings.bodyTemplate,
      {
        monitorName: incident.monitor.name,
        monitorUrl: incident.monitor.url,
        message: incident.message ?? "No error details available",
        timestamp: incident.startedAt.toISOString(),
        downtimeMinutes,
      }
    );

    if (!ticketId) {
      continue;
    }

    await prisma.incident.update({
      where: { id: incident.id },
      data: { zendeskTicketId: ticketId },
    });

    const ticketUrl = buildZendeskTicketUrl(zendeskSettings.subdomain, ticketId);
    await writeDebugLog(
      "zendesk_ticket",
      incident.monitor.name,
      "zendesk",
      `Zendesk ticket #${ticketId} created after ${downtimeMinutes} min of downtime — ${ticketUrl}`
    ).catch(() => {});
    zendeskTicketsCreated++;
  }

  return zendeskTicketsCreated;
}

export async function createZendeskSslTicket(
  zendeskSettings: ZendeskSettings,
  payload: ZendeskSslTicketInput
): Promise<NotificationZendeskMetadata | null> {
  if (!hasZendeskConfig(zendeskSettings) || !zendeskSettings.sslAlertsEnabled) {
    return null;
  }

  const expiryDate = payload.expiresAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const ticketId = await createZendeskTicket(
    {
      subdomain: zendeskSettings.subdomain,
      email: zendeskSettings.email,
      apiToken: zendeskSettings.apiToken,
      groupId: zendeskSettings.groupId,
    },
    getDefaultSslSubjectTemplate(payload.daysRemaining),
    getDefaultSslBodyTemplate(),
    {
      monitorName: payload.monitorName,
      monitorUrl: payload.monitorUrl,
      message: payload.message,
      timestamp: payload.timestamp,
      downtimeMinutes: 0,
      daysRemaining: payload.daysRemaining,
      expiryDate,
      issuer: payload.issuer,
    },
    ["uptime-monitor", "ssl-expiring"]
  );

  if (!ticketId) {
    await writeDebugLog(
      "zendesk_ticket_failed",
      payload.monitorName,
      "zendesk",
      `Failed to create Zendesk ticket for SSL alert: ${payload.message}`
    ).catch(() => {});
    return {
      url: null,
      display: "Zendesk: ❌",
      updated: false,
    };
  }

  const ticketUrl = buildZendeskTicketUrl(zendeskSettings.subdomain, ticketId);
  await writeDebugLog(
    "zendesk_ticket",
    payload.monitorName,
    "zendesk",
    `Zendesk ticket #${ticketId} created for SSL alert - ${ticketUrl}`
  ).catch(() => {});

  return {
    url: ticketUrl,
    display: "Zendesk: ✅",
    updated: true,
  };
}
