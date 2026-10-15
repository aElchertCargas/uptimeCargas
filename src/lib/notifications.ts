import { prisma } from "@/lib/prisma";
import { safeFetch } from "@/lib/safe-fetch";

interface WebhookConfig {
  url: string;
}

interface PushoverConfig {
  userKey: string;
  appToken: string;
  priority?: number;
  sound?: string;
  device?: string;
}

interface TeamsConfig {
  url: string;
  bodyType: "adaptive-card" | "adaptive-card-message" | "custom";
  customBody?: string;
  headers?: Record<string, string>;
}

export interface NotificationZendeskMetadata {
  url: string | null;
  display: string;
  updated: boolean;
}

export interface NotificationPayload {
  monitorName: string;
  monitorUrl: string;
  status: "down" | "up" | "ssl_expiring";
  message: string;
  timestamp: string;
  zendesk?: NotificationZendeskMetadata;
}

interface RecoveryNotificationOptions {
  monitorName: string;
  monitorUrl: string;
  responseTimeMs: number;
  incidentMessage: string | null;
  startedAt: Date;
  resolvedAt: Date;
  zendesk?: NotificationZendeskMetadata;
}

export interface NotificationDispatchResult {
  ok: boolean;
  error: string | null;
}

export async function sendWebhook(
  config: WebhookConfig,
  payload: NotificationPayload
): Promise<NotificationDispatchResult> {
  try {
    const response = await safeFetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: payload.status === "ssl_expiring"
          ? "monitor.ssl_expiring"
          : payload.status === "down"
            ? "monitor.down"
            : "monitor.up",
        monitor: {
          name: payload.monitorName,
          url: payload.monitorUrl,
        },
        message: payload.message,
        timestamp: payload.timestamp,
        ...(payload.zendesk ? { zendesk: payload.zendesk } : {}),
      }),
    });
    if (response.ok) {
      return { ok: true, error: null };
    }

    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown webhook error",
    };
  }
}

export async function sendPushover(
  config: PushoverConfig,
  payload: NotificationPayload
): Promise<NotificationDispatchResult> {
  const icon = payload.status === "down" ? "🔴" : payload.status === "ssl_expiring" ? "🟡" : "🟢";
  const title = payload.status === "ssl_expiring"
    ? `${icon} ${payload.monitorName} SSL Certificate Expiring`
    : `${icon} ${payload.monitorName} is ${payload.status.toUpperCase()}`;

  try {
    const response = await safeFetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: config.appToken,
        user: config.userKey,
        title,
        message: payload.message,
        priority: config.priority ?? (payload.status === "down" ? 1 : 0),
        sound: config.sound ?? (payload.status === "down" ? "siren" : "pushover"),
        url: payload.monitorUrl,
        url_title: "View Monitor",
        ...(config.device && { device: config.device }),
      }),
    });
    if (response.ok) {
      return { ok: true, error: null };
    }

    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Pushover error",
    };
  }
}

export function buildRecoveryNotificationPayload(
  options: RecoveryNotificationOptions
): NotificationPayload {
  const downtimeSeconds = Math.round(
    (options.resolvedAt.getTime() - options.startedAt.getTime()) / 1000
  );
  const incidentMessage = options.incidentMessage ?? "Unknown error";
  const message = `${options.monitorName} is back UP after ${downtimeSeconds}s (${options.responseTimeMs}ms). Previous error: ${incidentMessage}`;

  return {
    monitorName: options.monitorName,
    monitorUrl: options.monitorUrl,
    status: "up",
    message,
    timestamp: options.resolvedAt.toISOString(),
    ...(options.zendesk ? { zendesk: options.zendesk } : {}),
  };
}

function toEST(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

function interpolateTemplate(template: string, payload: NotificationPayload): string {
  return template
    .replace(/\{\{monitorName\}\}/g, payload.monitorName)
    .replace(/\{\{monitorUrl\}\}/g, payload.monitorUrl)
    .replace(/\{\{status\}\}/g, payload.status)
    .replace(/\{\{message\}\}/g, payload.message)
    .replace(/\{\{timestamp\}\}/g, toEST(payload.timestamp))
    .replace(/\{\{zendeskDisplay\}\}/g, payload.zendesk?.display ?? "")
    .replace(/\{\{zendeskUrl\}\}/g, payload.zendesk?.url ?? "")
    .replace(/\{\{zendeskUpdated\}\}/g, String(payload.zendesk?.updated ?? false));
}

function buildAdaptiveCard(payload: NotificationPayload) {
  const color = payload.status === "down" ? "attention" : payload.status === "ssl_expiring" ? "warning" : "good";
  const icon = payload.status === "down" ? "🔴" : payload.status === "ssl_expiring" ? "🟡" : "🟢";
  const estTime = toEST(payload.timestamp);
  const facts = [
    { title: "Monitor", value: payload.monitorName },
    {
      title: "URL",
      value: payload.monitorUrl,
    },
    { title: "Status", value: payload.status.toUpperCase() },
    { title: "Time", value: estTime },
    ...(payload.zendesk
      ? [
          {
            title: "Zendesk",
            value: payload.zendesk.url
              ? `[${payload.zendesk.display}](${payload.zendesk.url})`
              : payload.zendesk.display,
          },
        ]
      : []),
  ];

  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body: [
      {
        type: "TextBlock",
        size: "medium",
        weight: "bolder",
        text: payload.status === "ssl_expiring"
          ? `${icon} ${payload.monitorName} SSL Certificate Expiring`
          : `${icon} ${payload.monitorName} is ${payload.status.toUpperCase()}`,
        color,
      },
      {
        type: "FactSet",
        facts,
      },
      {
        type: "TextBlock",
        text: payload.message,
        wrap: true,
        spacing: "small",
      },
    ],
  };
}

export async function sendTeams(
  config: TeamsConfig,
  payload: NotificationPayload
): Promise<NotificationDispatchResult> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    };

    let body: string;
    if (config.bodyType === "custom" && config.customBody) {
      body = interpolateTemplate(config.customBody, payload);
    } else if (config.bodyType === "adaptive-card-message") {
      body = JSON.stringify({
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            contentUrl: null,
            content: buildAdaptiveCard(payload),
          },
        ],
      });
    } else {
      body = JSON.stringify(buildAdaptiveCard(payload));
    }

    const response = await safeFetch(config.url, {
      method: "POST",
      headers,
      body,
    });
    if (response.ok) {
      return { ok: true, error: null };
    }

    return {
      ok: false,
      error: `HTTP ${response.status} ${response.statusText}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Teams error",
    };
  }
}

export async function dispatchNotificationDetailed(
  channelType: string,
  channelName: string,
  config: Record<string, unknown>,
  payload: NotificationPayload
): Promise<NotificationDispatchResult> {
  let result: NotificationDispatchResult;
  switch (channelType) {
    case "webhook":
      result = await sendWebhook(config as unknown as WebhookConfig, payload);
      break;
    case "pushover":
      result = await sendPushover(config as unknown as PushoverConfig, payload);
      break;
    case "teams":
      result = await sendTeams(config as unknown as TeamsConfig, payload);
      break;
    default:
      result = {
        ok: false,
        error: `Unsupported notification channel type: ${channelType}`,
      };
      break;
  }

  await writeDebugLog(
    result.ok ? "webhook_sent" : "webhook_failed",
    payload.monitorName,
    channelName,
    result.ok
      ? `${channelType} notification sent (${payload.status})`
      : `${channelType} notification failed (${payload.status})${result.error ? `: ${result.error}` : ""}`
  ).catch(() => {});

  return result;
}

export async function dispatchNotification(
  channelType: string,
  channelName: string,
  config: Record<string, unknown>,
  payload: NotificationPayload
): Promise<boolean> {
  const result = await dispatchNotificationDetailed(
    channelType,
    channelName,
    config,
    payload
  );

  return result.ok;
}

export async function writeDebugLog(
  type: string,
  monitor: string,
  channel: string | null,
  message: string
) {
  const enabled = await prisma.appSetting
    .findUnique({ where: { key: "debugLogEnabled" } })
    .then((r) => r?.value !== "false")
    .catch(() => true);
  if (!enabled) return;

  await prisma.debugLog.create({
    data: { type, monitor, channel, message },
  });
}
