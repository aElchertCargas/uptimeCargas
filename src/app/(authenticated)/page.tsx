"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { StatsHeader } from "@/components/dashboard/stats-header";
import { MonitorGrid } from "@/components/dashboard/monitor-grid";
import { RecentEvents } from "@/components/dashboard/recent-events";
import type { StatsResponse, StatusFilter } from "@/components/dashboard/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Plus } from "lucide-react";
import { toast } from "sonner";

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading, dataUpdatedAt } = useQuery<StatsResponse>({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    refetchInterval: 30 * 1000,
  });

  const runChecks = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/cron/check", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Check cycle failed");
      return res.json();
    },
    onSuccess: (result) => {
      const suppressed = result.suppression?.suppressedDownTransitions ?? 0;
      toast.success(
        suppressed > 0
          ? `Checked ${result.checked} monitor(s). Suppressed ${suppressed} suspicious down alert(s).`
          : `Checked ${result.checked} monitor(s)`
      );
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to run checks"),
  });

  // Keep "x ago" labels in step with fresh data, not just the 30s tick.
  const renderNow = Math.max(now, dataUpdatedAt);
  const lastCycleAt = data?.summary.lastCycleAt;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="font-mono text-xs text-muted-foreground">
            {lastCycleAt
              ? `Last cycle ${formatTime(new Date(lastCycleAt))}`
              : "No checks yet"}
            {dataUpdatedAt > 0 && ` · refreshed ${formatTime(new Date(dataUpdatedAt))}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => runChecks.mutate()}
            disabled={runChecks.isPending}
          >
            {runChecks.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Run Checks
          </Button>
          <Button size="sm" asChild>
            <Link href="/monitors/new">
              <Plus className="size-4" />
              Add Monitor
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[106px] rounded-xl" />
            ))}
          </div>
          <div className="flex flex-wrap gap-5">
            <Skeleton className="h-96 min-w-0 flex-[3_1_640px] rounded-xl" />
            <Skeleton className="h-96 flex-[1_1_300px] rounded-xl" />
          </div>
        </div>
      ) : data ? (
        <>
          <AttentionPanel
            monitors={data.monitors}
            now={renderNow}
            onShowDown={() => setStatusFilter("down")}
          />
          <StatsHeader
            summary={data.summary}
            monitors={data.monitors}
            now={renderNow}
            activeFilter={statusFilter}
            onFilter={setStatusFilter}
          />
          <div className="flex flex-wrap items-start gap-5">
            <div className="min-w-0 flex-[3_1_640px]">
              <MonitorGrid
                monitors={data.monitors}
                summary={data.summary}
                now={renderNow}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
              />
            </div>
            <div className="min-w-0 flex-[1_1_300px]">
              <RecentEvents events={data.events} />
            </div>
          </div>
        </>
      ) : (
        <div className="flex h-64 items-center justify-center rounded-xl border bg-card">
          <p className="font-mono text-sm text-muted-foreground">
            Couldn&apos;t load dashboard data.
          </p>
        </div>
      )}
    </div>
  );
}
