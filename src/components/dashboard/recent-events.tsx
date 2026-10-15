"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClock, formatDuration, type DashboardEvent } from "./types";

export function RecentEvents({ events }: { events: DashboardEvent[] }) {
  return (
    <section
      aria-labelledby="events-heading"
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 id="events-heading" className="text-[15px] font-semibold">
          Recent events
        </h2>
        <span className="font-mono text-xs text-muted-foreground">last 24h</span>
      </div>

      {events.length === 0 ? (
        <p className="px-4 py-10 text-center font-mono text-[13px] text-muted-foreground">
          No incidents in the last 24h
        </p>
      ) : (
        <ol className="px-4 py-2">
          {events.map((event) => {
            const down = event.kind === "down";
            const Icon = down ? ArrowDown : ArrowUp;
            const detail = down
              ? event.message ?? "Check failed"
              : event.durationMs != null
                ? `Down ${formatDuration(event.durationMs)}`
                : "Recovered";
            return (
              <li key={event.id} className="flex gap-3 py-2.5">
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                    down
                      ? "bg-status-down/10 text-status-down"
                      : "bg-status-up/10 text-status-up"
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate text-sm">
                      <Link
                        href={`/monitors/${event.monitorId}`}
                        className="font-medium hover:underline"
                      >
                        {event.monitorName}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        {down ? "went down" : "recovered"}
                      </span>
                    </p>
                    <time
                      dateTime={event.at}
                      className="shrink-0 font-mono text-xs text-muted-foreground"
                    >
                      {formatClock(event.at)}
                    </time>
                  </div>
                  <p
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={detail}
                  >
                    {detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
