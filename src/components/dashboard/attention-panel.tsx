"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  SSL_WARNING_DAYS,
  daysUntil,
  formatDuration,
  getMonitorStatus,
  type MonitorData,
} from "./types";

interface AttentionPanelProps {
  monitors: MonitorData[];
  now: number;
  onShowDown: () => void;
}

export function AttentionPanel({ monitors, now, onShowDown }: AttentionPanelProps) {
  const down = monitors
    .filter((m) => getMonitorStatus(m) === "down")
    .sort((a, b) => (a.downSince ?? "￿").localeCompare(b.downSince ?? "￿"));
  const sslExpiring = monitors
    .filter(
      (m) =>
        m.active &&
        m.sslExpiresAt &&
        daysUntil(m.sslExpiresAt, now) <= SSL_WARNING_DAYS
    )
    .sort((a, b) => a.sslExpiresAt!.localeCompare(b.sslExpiresAt!));

  if (down.length === 0 && sslExpiring.length === 0) return null;

  const suppressedCount = down.filter((m) => m.suppressedDownAt).length;
  const parts = [
    down.length > 0 && `${down.length} down`,
    suppressedCount > 0 && `${suppressedCount} suppressed`,
    sslExpiring.length > 0 && `${sslExpiring.length} SSL expiring`,
  ].filter(Boolean);

  return (
    <section
      aria-labelledby="attention-heading"
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "size-2.5 rounded-full",
              down.length > 0
                ? "bg-status-down ring-4 ring-status-down/15"
                : "bg-status-pending ring-4 ring-status-pending/15"
            )}
          />
          <h2 id="attention-heading" className="text-[15px] font-semibold">
            Needs attention
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {parts.join(" · ")}
          </span>
        </div>
        {down.length > 0 && (
          <Button size="sm" variant="outline" onClick={onShowDown}>
            Show down only
          </Button>
        )}
      </div>

      {down.map((m) => {
        const suppressed = !!m.suppressedDownAt;
        const since = m.downSince ?? m.suppressedDownAt;
        const detail = suppressed
          ? m.suppressedDownMessage ?? "Down alert held by bulk-failure protection"
          : m.downMessage ?? "Check failed";
        return (
          <AttentionRow
            key={m.id}
            href={`/monitors/${m.id}`}
            badge={suppressed ? "SUPPRESSED" : "DOWN"}
            tone={suppressed ? "pending" : "down"}
            title={m.name}
            detail={detail}
            meta={since ? `down ${formatDuration(now - new Date(since).getTime())}` : null}
          />
        );
      })}

      {sslExpiring.map((m) => {
        const days = daysUntil(m.sslExpiresAt!, now);
        return (
          <AttentionRow
            key={`ssl-${m.id}`}
            href={`/monitors/${m.id}`}
            badge="SSL"
            tone={days <= 7 ? "down" : "pending"}
            title={m.name}
            detail={`Certificate ${days < 0 ? "expired" : "expires"} ${new Date(
              m.sslExpiresAt!
            ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            meta={days < 0 ? `${-days} d ago` : `${days} d left`}
          />
        );
      })}
    </section>
  );
}

function AttentionRow({
  href,
  badge,
  tone,
  title,
  detail,
  meta,
}: {
  href: string;
  badge: string;
  tone: "down" | "pending";
  title: string;
  detail: string;
  meta: string | null;
}) {
  return (
    <Link
      href={href}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 transition-colors hover:bg-muted/60"
    >
      <span
        className={cn(
          "inline-flex h-[22px] w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-full font-mono text-[11px] font-medium tracking-wide",
          tone === "down"
            ? "bg-status-down/10 text-status-down"
            : "bg-status-pending/10 text-status-pending"
        )}
      >
        {badge}
      </span>
      <span className="min-w-[180px] truncate text-sm font-medium">{title}</span>
      <span className="min-w-[200px] flex-1 truncate font-mono text-xs text-muted-foreground">
        {detail}
      </span>
      {meta && (
        <span
          className={cn(
            "font-mono text-xs",
            tone === "down" ? "text-status-down" : "text-status-pending"
          )}
        >
          {meta}
        </span>
      )}
    </Link>
  );
}
