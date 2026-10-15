"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Send,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  Loader2,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface DebugLogEntry {
  id: string;
  type: string;
  monitor: string;
  channel: string | null;
  message: string;
  createdAt: string;
}

interface DebugLogResponse {
  enabled: boolean;
  logs: DebugLogEntry[];
}

const TYPE_META: Record<string, { icon: typeof ArrowDown; color: string; label: string; badgeClass: string }> = {
  down:           { icon: ArrowDown,      color: "text-[var(--color-status-down)]", label: "DOWN",    badgeClass: "bg-[var(--color-status-down)] text-white" },
  up:             { icon: ArrowUp,        color: "text-[var(--color-status-up)]",   label: "UP",      badgeClass: "bg-[var(--color-status-up)] text-white" },
  webhook_sent:   { icon: Send,           color: "text-blue-400",                   label: "SENT",    badgeClass: "bg-blue-500 text-white" },
  webhook_failed: { icon: AlertTriangle,  color: "text-amber-400",                 label: "FAIL",    badgeClass: "bg-amber-500 text-white" },
  zendesk_ticket: { icon: Send,           color: "text-violet-400",                label: "ZENDESK", badgeClass: "bg-violet-500 text-white" },
  zendesk_ticket_failed: {
    icon: AlertTriangle,
    color: "text-violet-400",
    label: "ZENDESK FAIL",
    badgeClass: "bg-violet-700 text-white",
  },
  ssl_expiring:   { icon: ShieldAlert,    color: "text-amber-400",                 label: "SSL",     badgeClass: "bg-amber-500 text-white" },
  ssl_error:      { icon: ShieldAlert,    color: "text-[var(--color-status-down)]", label: "SSL ERR", badgeClass: "bg-[var(--color-status-down)] text-white" },
};

type FilterType =
  | "all"
  | "down"
  | "up"
  | "webhook_sent"
  | "webhook_failed"
  | "zendesk_ticket"
  | "zendesk_ticket_failed"
  | "ssl_expiring"
  | "ssl_error";

interface SchedulerJob {
  key: string;
  name: string;
  status: "healthy" | "running" | "stale" | "unknown";
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runs: number;
  failures: number;
  errors24h: number;
}

interface SchedulerHealth {
  now: string;
  running: boolean;
  startedAt: string | null;
  jobs: SchedulerJob[];
  stats: {
    activeMonitors: number;
    dueNow: number;
    maxOverdueMs: number;
    checks5m: number;
    failed5m: number;
    pendingAlerts: number;
    openIncidents: number;
    dbLatencyMs: number;
  };
  events: { id: string; type: string; message: string; createdAt: string }[];
}

const HEALTH_DOT: Record<string, string> = {
  healthy: "bg-[var(--color-status-up)]",
  running: "bg-blue-400 animate-pulse",
  stale: "bg-[var(--color-status-down)]",
  unknown: "bg-muted-foreground",
};

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function timeAgo(dateStr: string | null, nowMs: number): string {
  if (!dateStr) return "never";
  return `${formatDuration(nowMs - new Date(dateStr).getTime())} ago`;
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-lg font-semibold", warn && "text-amber-400")}>{value}</div>
    </div>
  );
}

function SchedulerHealthPanel() {
  const { data, isError, dataUpdatedAt } = useQuery<SchedulerHealth>({
    queryKey: ["scheduler-health"],
    queryFn: async () => {
      const res = await fetch("/api/scheduler/health");
      if (!res.ok) throw new Error("Failed to fetch scheduler health");
      return res.json();
    },
    refetchInterval: 5_000,
  });

  // Tick every second so countdowns move between polls.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!data) return null;
  const { stats } = data;
  const stale = data.jobs.some((j) => j.status === "stale");
  const level = !data.running || isError ? "down" : stale ? "degraded" : "ok";
  const failRate = stats.checks5m ? Math.round((stats.failed5m / stats.checks5m) * 100) : 0;

  return (
    <section className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Activity className="size-4" />
          Scheduler health
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-status-up)] opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-[var(--color-status-up)]" />
          </span>
          <span className="font-mono text-xs font-normal text-muted-foreground">live</span>
        </div>
        <Badge
          className={cn(
            "text-[10px]",
            level === "ok" ? "bg-[var(--color-status-up)] text-white" : "bg-[var(--color-status-down)] text-white"
          )}
        >
          {level === "down" ? (isError ? "UNREACHABLE" : "NOT RUNNING") : level === "degraded" ? "DEGRADED" : "HEALTHY"}
        </Badge>
      </div>

      <div className="grid gap-4 px-6 py-4 sm:grid-cols-3">
        {data.jobs.map((job) => {
          const nextMs = job.nextRunAt ? new Date(job.nextRunAt).getTime() - nowMs : null;
          const lastMs = job.lastRunAt ? new Date(job.lastRunAt).getTime() : null;
          const total = job.intervalMs;
          const pct =
            job.status === "running"
              ? 100
              : nextMs == null
                ? 0
                : Math.min(100, Math.max(0, ((total - Math.max(nextMs, 0)) / total) * 100));
          return (
            <div key={job.key} className="space-y-2 rounded-lg border p-3 font-mono text-xs">
              <div className="flex items-center justify-between text-sm font-medium">
                <span className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", HEALTH_DOT[job.status])} />
                  {job.name}
                </span>
                <span className="text-[10px] uppercase text-muted-foreground">{job.status}</span>
              </div>
              <div className="text-base font-semibold">
                {job.status === "running"
                  ? "Running now…"
                  : nextMs == null
                    ? "Next run: unknown"
                    : nextMs <= 0
                      ? "Due now"
                      : `Next in ${formatDuration(nextMs)}`}
              </div>
              <div className="h-1 overflow-hidden rounded bg-muted">
                <div
                  className={cn("h-full transition-[width] duration-1000 ease-linear", job.status === "stale" ? "bg-[var(--color-status-down)]" : "bg-blue-400")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="space-y-0.5 text-muted-foreground">
                <div>Last run: {lastMs ? timeAgo(job.lastRunAt, nowMs) : "never"}{job.lastDurationMs != null && ` · took ${formatDuration(job.lastDurationMs)}`}</div>
                <div>Every {formatDuration(job.intervalMs)} · {job.runs} run(s) · {job.failures} failed</div>
              </div>
              {job.lastError && <div className="text-[var(--color-status-down)]">{job.lastError}</div>}
              {job.errors24h > 0 && <div className="text-amber-400">{job.errors24h} error(s) in 24h</div>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-4 border-t px-6 py-4 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Active monitors" value={stats.activeMonitors} />
        <Stat label="Due now" value={stats.dueNow} warn={stats.dueNow > Math.max(5, stats.activeMonitors * 0.2)} />
        <Stat label="Max overdue" value={formatDuration(stats.maxOverdueMs)} warn={stats.maxOverdueMs > 120_000} />
        <Stat label="Checks / 5m" value={stats.checks5m} />
        <Stat label="Failed / 5m" value={`${stats.failed5m} (${failRate}%)`} warn={stats.failed5m > 0} />
        <Stat label="Pending alerts" value={stats.pendingAlerts} warn={stats.pendingAlerts > 0} />
        <Stat label="Open incidents" value={stats.openIncidents} warn={stats.openIncidents > 0} />
        <Stat label="DB latency" value={`${stats.dbLatencyMs}ms`} warn={stats.dbLatencyMs > 500} />
      </div>

      {data.events.length > 0 && (
        <div className="border-t px-6 py-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Recent scheduler events</div>
          <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
            {data.events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-16 shrink-0">{timeAgo(e.createdAt, nowMs)}</span>
                <span className="w-32 shrink-0">{e.type}</span>
                <span className="truncate">{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t px-6 py-2 font-mono text-xs text-muted-foreground">
        Scheduler {data.running ? "running" : "stopped"}
        {data.startedAt && ` · up ${formatDuration(nowMs - new Date(data.startedAt).getTime())}`}
        {" · "}updated {formatDuration(nowMs - dataUpdatedAt)} ago · polls every 5s
      </div>
    </section>
  );
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function DebugLogPage() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");

  const { data, isLoading } = useQuery<DebugLogResponse>({
    queryKey: ["debug-log-full"],
    queryFn: async () => {
      const res = await fetch("/api/debug-log?limit=500");
      if (!res.ok) throw new Error("Failed to fetch debug log");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/debug-log", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debug-log-full"] });
      queryClient.invalidateQueries({ queryKey: ["debug-log"] });
      toast.success("Debug log cleared");
    },
  });

  const allLogs = data?.logs ?? [];
  const logs = typeFilter === "all" ? allLogs : allLogs.filter((l) => l.type === typeFilter);

  const counts: Record<FilterType, number> = {
    all: allLogs.length,
    down: allLogs.filter((l) => l.type === "down").length,
    up: allLogs.filter((l) => l.type === "up").length,
    webhook_sent: allLogs.filter((l) => l.type === "webhook_sent").length,
    webhook_failed: allLogs.filter((l) => l.type === "webhook_failed").length,
    zendesk_ticket: allLogs.filter((l) => l.type === "zendesk_ticket").length,
    zendesk_ticket_failed: allLogs.filter((l) => l.type === "zendesk_ticket_failed").length,
    ssl_expiring: allLogs.filter((l) => l.type === "ssl_expiring").length,
    ssl_error: allLogs.filter((l) => l.type === "ssl_error").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Debug Log</h1>
          <p className="text-sm text-muted-foreground">
            Down and up events, webhook dispatches, Zendesk tickets and SSL alerts. Refreshes every 15 seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending || allLogs.length === 0}
        >
          {clearMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          Clear All
        </Button>
      </div>

      <SchedulerHealthPanel />

      <section className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-wrap gap-2 border-b px-6 py-4">
        {([
          "all",
          "down",
          "up",
          "webhook_sent",
          "webhook_failed",
          "zendesk_ticket",
          "zendesk_ticket_failed",
          "ssl_expiring",
          "ssl_error",
        ] as FilterType[]).map((f) => {
          const meta = TYPE_META[f];
          const active = typeFilter === f;
          return (
            <Button
              key={f}
              variant={active ? "default" : "outline"}
              size="sm"
              className="gap-1.5 font-mono text-xs"
              onClick={() => setTypeFilter(f)}
            >
              {meta && <meta.icon className={cn("size-3.5", !active && meta.color)} />}
              {f === "all" ? "All" : meta?.label ?? f}
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] leading-none", active ? "bg-primary-foreground/20" : "bg-muted")}>
                {counts[f]}
              </span>
            </Button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="font-mono text-sm text-muted-foreground">
            {allLogs.length === 0 ? "No debug log entries yet" : "No entries match this filter"}
          </p>
        </div>
      ) : (
        <div className="px-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono w-[140px]">Time</TableHead>
                <TableHead className="font-mono w-[80px]">Type</TableHead>
                <TableHead className="font-mono">Monitor</TableHead>
                <TableHead className="font-mono">Channel</TableHead>
                <TableHead className="font-mono">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((entry) => {
                const meta = TYPE_META[entry.type] ?? TYPE_META.down;
                const Icon = meta.icon;
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("gap-1 text-[10px]", meta.badgeClass)}>
                        <Icon className="size-3" />
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm font-medium">
                      {entry.monitor}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.channel ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-md">
                      {entry.message}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 font-mono text-xs text-muted-foreground">
          <span>Showing {logs.length} of {allLogs.length} entries</span>
          <span>Newest first</span>
        </div>
      </section>

      {!data?.enabled && !isLoading && (
        <p className="text-center text-sm text-muted-foreground">
          Debug logging is currently disabled. Enable it in{" "}
          <a href="/settings" className="underline">Settings</a>.
        </p>
      )}
    </div>
  );
}
