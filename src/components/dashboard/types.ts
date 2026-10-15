export type SlotState = "up" | "down" | "none";

export interface MonitorData {
  id: string;
  name: string;
  url: string;
  active: boolean;
  interval: number;
  tags: string[];
  lastStatus: boolean | null;
  lastResponseTime: number | null;
  lastCheckedAt: string | null;
  uptime24h: number | null;
  avgResponseTime: number | null;
  sslExpiresAt: string | null;
  suppressedDownAt: string | null;
  suppressedDownMessage: string | null;
  downSince: string | null;
  downMessage: string | null;
  // Last 60 minutes in two-minute slots, oldest first.
  history: SlotState[];
}

export interface StatsSummary {
  total: number;
  active: number;
  up: number;
  down: number;
  paused: number;
  lastCycleAt: string | null;
}

export interface DashboardEvent {
  id: string;
  kind: "down" | "up";
  monitorId: string;
  monitorName: string;
  message: string | null;
  durationMs?: number;
  at: string;
}

export interface StatsResponse {
  summary: StatsSummary;
  monitors: MonitorData[];
  events: DashboardEvent[];
}

export type MonitorStatus = "up" | "down" | "paused" | "pending";
export type StatusFilter = "all" | "up" | "down" | "paused";

export const SSL_WARNING_DAYS = 14;

export function getMonitorStatus(monitor: MonitorData): MonitorStatus {
  if (!monitor.active) return "paused";
  if (monitor.lastStatus == null) return "pending";
  return monitor.lastStatus ? "up" : "down";
}

export function daysUntil(iso: string, now = Date.now()): number {
  return Math.floor((new Date(iso).getTime() - now) / 86_400_000);
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${formatDuration(seconds * 1000)} ago`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
