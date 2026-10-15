"use client";

import { cn } from "@/lib/utils";
import {
  formatDuration,
  getMonitorStatus,
  type MonitorData,
  type StatsSummary,
  type StatusFilter,
} from "./types";

interface StatsHeaderProps {
  summary: StatsSummary;
  monitors: MonitorData[];
  now: number;
  activeFilter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
}

export function StatsHeader({
  summary,
  monitors,
  now,
  activeFilter,
  onFilter,
}: StatsHeaderProps) {
  const longestDownSince = monitors
    .filter((m) => getMonitorStatus(m) === "down")
    .map((m) => m.downSince ?? m.suppressedDownAt)
    .filter((s): s is string => !!s)
    .sort()[0];

  const tiles: {
    filter: StatusFilter;
    label: string;
    dot: string;
    value: React.ReactNode;
    caption: string;
    alert?: boolean;
  }[] = [
    {
      filter: "up",
      label: "Up",
      dot: "bg-status-up",
      value: (
        <>
          {summary.up}
          <span className="text-sm text-muted-foreground"> / {summary.active}</span>
        </>
      ),
      caption: "active monitors",
    },
    {
      filter: "down",
      label: "Down",
      dot: "bg-status-down",
      value: summary.down,
      caption: longestDownSince
        ? `longest ${formatDuration(now - new Date(longestDownSince).getTime())}`
        : "all clear",
      alert: summary.down > 0,
    },
    {
      filter: "paused",
      label: "Paused",
      dot: "bg-status-pending",
      value: summary.paused,
      caption: "not checked",
    },
  ];

  return (
    <section aria-label="Summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map((tile) => {
        const selected = activeFilter === tile.filter;
        return (
          <button
            key={tile.filter}
            type="button"
            aria-pressed={selected}
            onClick={() => onFilter(selected ? "all" : tile.filter)}
            className={cn(
              "rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              tile.alert && "border-status-down",
              selected && "ring-2 ring-foreground/15"
            )}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className={cn("size-2 rounded-full", tile.dot)} />
              {tile.label}
            </div>
            <div
              className={cn(
                "mt-1.5 font-mono text-[26px] font-medium tracking-tight",
                tile.alert && "text-status-down"
              )}
            >
              {tile.value}
            </div>
            <div className="mt-1.5 font-mono text-xs text-muted-foreground">
              {tile.caption}
            </div>
          </button>
        );
      })}
    </section>
  );
}
