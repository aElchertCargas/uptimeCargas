"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Send,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  Loader2,
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
