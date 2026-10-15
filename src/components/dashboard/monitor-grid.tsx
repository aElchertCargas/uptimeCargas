"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  MousePointerClick,
  X,
  Trash2,
  Ban,
  Play,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  SSL_WARNING_DAYS,
  daysUntil,
  formatAgo,
  getMonitorStatus,
  type MonitorData,
  type MonitorStatus,
  type StatsSummary,
  type StatusFilter,
} from "./types";

interface MonitorGridProps {
  monitors: MonitorData[];
  summary: StatsSummary;
  now: number;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
}

type SortKey = "status" | "name" | "slowest" | "uptime";

const STATUS_ORDER: Record<MonitorStatus, number> = {
  down: 0,
  pending: 1,
  up: 2,
  paused: 3,
};

const STATUS_LABEL: Record<MonitorStatus, string> = {
  up: "UP",
  down: "DOWN",
  paused: "PAUSED",
  pending: "PENDING",
};

const STATUS_BADGE: Record<MonitorStatus, string> = {
  up: "bg-status-up/10 text-status-up",
  down: "bg-status-down/10 text-status-down",
  paused: "bg-status-pending/10 text-status-pending",
  pending: "bg-muted text-muted-foreground",
};

const STATUS_DOT: Record<MonitorStatus | "all", string> = {
  all: "bg-foreground",
  up: "bg-status-up",
  down: "bg-status-down",
  paused: "bg-status-pending",
  pending: "bg-muted-foreground",
};

function compareMonitors(sort: SortKey) {
  const byName = (a: MonitorData, b: MonitorData) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  switch (sort) {
    case "name":
      return byName;
    case "slowest":
      return (a: MonitorData, b: MonitorData) =>
        (b.lastResponseTime ?? -1) - (a.lastResponseTime ?? -1) || byName(a, b);
    case "uptime":
      return (a: MonitorData, b: MonitorData) =>
        (a.uptime24h ?? 101) - (b.uptime24h ?? 101) || byName(a, b);
    default:
      return (a: MonitorData, b: MonitorData) =>
        STATUS_ORDER[getMonitorStatus(a)] - STATUS_ORDER[getMonitorStatus(b)] ||
        byName(a, b);
  }
}

type BulkAction = "delete" | "ban-delete" | "check" | null;

export function MonitorGrid({
  monitors,
  summary,
  now,
  statusFilter,
  onStatusFilterChange,
}: MonitorGridProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("status");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<BulkAction>(null);

  const tags = useMemo(
    () => [...new Set(monitors.flatMap((m) => m.tags))].sort(),
    [monitors]
  );

  const filteredMonitors = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return monitors
      .filter((m) => {
        if (statusFilter !== "all" && getMonitorStatus(m) !== statusFilter) return false;
        if (tagFilter !== "all" && !m.tags.includes(tagFilter)) return false;
        return (
          !q || m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q)
        );
      })
      .sort(compareMonitors(sort));
  }, [monitors, searchQuery, statusFilter, tagFilter, sort]);

  const filters: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: summary.total },
    { id: "up", label: "Up", count: summary.up },
    { id: "down", label: "Down", count: summary.down },
    { id: "paused", label: "Paused", count: summary.paused },
  ];

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredMonitors.map((m) => m.id)));
  }, [filteredMonitors]);

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/monitors/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitorIds: ids }),
      });
      if (!res.ok) throw new Error("Failed to delete monitors");
      return res.json();
    },
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} monitor(s)`);
      exitSelectMode();
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: () => toast.error("Failed to delete monitors"),
  });

  const bulkBanDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/monitors/bulk-ban-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitorIds: ids }),
      });
      if (!res.ok) throw new Error("Failed to ban & delete monitors");
      return res.json();
    },
    onSuccess: (result) => {
      toast.success(
        `Deleted ${result.deleted} monitor(s), banned ${result.banned} hostname(s)`
      );
      exitSelectMode();
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: () => toast.error("Failed to ban & delete monitors"),
  });

  const bulkCheck = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/monitors/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitorIds: ids }),
      });
      if (!res.ok) throw new Error("Failed to run checks");
      return res.json();
    },
    onSuccess: (result) => {
      const suppressed = result.suppression?.suppressedDownTransitions ?? 0;
      toast.success(
        suppressed > 0
          ? `Checked ${result.checked} monitor(s). Suppressed ${suppressed} suspicious down alert(s).`
          : `Checked ${result.checked} monitor(s)`
      );
      exitSelectMode();
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: () => toast.error("Failed to run checks"),
  });

  const isBusy =
    bulkDelete.isPending || bulkBanDelete.isPending || bulkCheck.isPending;

  function executeAction() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    switch (confirmAction) {
      case "delete":
        bulkDelete.mutate(ids);
        break;
      case "ban-delete":
        bulkBanDelete.mutate(ids);
        break;
      case "check":
        bulkCheck.mutate(ids);
        break;
    }
    setConfirmAction(null);
  }

  const confirmMessages: Record<string, { title: string; description: string; button: string }> = {
    delete: {
      title: "Delete selected monitors",
      description: `Are you sure you want to delete ${selectedIds.size} monitor(s)? This cannot be undone.`,
      button: "Delete",
    },
    "ban-delete": {
      title: "Ban & delete selected monitors",
      description: `This will add ${selectedIds.size} hostname(s) to the excluded patterns list and delete the monitors. Future syncs will skip these URLs.`,
      button: "Ban & Delete",
    },
    check: {
      title: "Run checks on selected monitors",
      description: `Run an immediate ping check on ${selectedIds.size} monitor(s)?`,
      button: "Run Checks",
    },
  };

  const selectClass =
    "h-8 rounded-md border border-input bg-card px-2 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <section
      aria-labelledby="monitors-heading"
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      {/* Title + status filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id="monitors-heading" className="text-[15px] font-semibold">
          Monitors
        </h2>
        <div
          role="group"
          aria-label="Status filter"
          className="flex flex-wrap gap-0.5 rounded-[10px] bg-muted p-[3px]"
        >
          {filters.map((f) => {
            const on = statusFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => onStatusFilterChange(f.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-md border border-transparent px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
                  on && "border-border bg-card text-foreground shadow-sm"
                )}
              >
                <span className={cn("size-2 rounded-full", STATUS_DOT[f.id])} />
                {f.label}
                <span className="font-mono text-xs text-muted-foreground">{f.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search monitors"
            placeholder="Search name or URL"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-[13px]"
          />
        </div>
        {tags.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Tag
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className={cn(selectClass, "text-foreground")}
            >
              <option value="all">All tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={cn(selectClass, "text-foreground")}
          >
            <option value="status">Status, then name</option>
            <option value="name">Name</option>
            <option value="slowest">Slowest first</option>
            <option value="uptime">Lowest uptime</option>
          </select>
        </label>
        {selectMode ? (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={selectAll}>
              All
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Exit select mode"
              onClick={exitSelectMode}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>
            <MousePointerClick className="size-4" />
            Select
          </Button>
        )}
      </div>

      {/* Table */}
      {filteredMonitors.length === 0 ? (
        <div className="px-4 py-10 text-center font-mono text-[13px] text-muted-foreground">
          {monitors.length === 0
            ? "No monitors yet. Add one to get started."
            : "No monitors match this filter."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {selectMode && <th className="w-10 px-3 py-2.5" />}
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-3 py-2.5 text-left font-medium">Monitor</th>
                <th className="px-3 py-2.5 text-left font-medium">Last 60 min</th>
                <th className="px-3 py-2.5 text-right font-medium">Response</th>
                <th className="px-3 py-2.5 text-right font-medium">Uptime 24h</th>
                <th className="px-3 py-2.5 text-right font-medium">SSL</th>
                <th className="px-3 py-2.5 text-right font-medium">Checked</th>
              </tr>
            </thead>
            <tbody>
              {filteredMonitors.map((m) => (
                <MonitorRow
                  key={m.id}
                  monitor={m}
                  now={now}
                  selectMode={selectMode}
                  selected={selectedIds.has(m.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t px-4 py-2.5 font-mono text-xs text-muted-foreground">
        Showing {filteredMonitors.length} of {monitors.length}
      </div>

      {/* Floating action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg">
            <span className="mr-2 font-mono text-sm font-medium">
              {selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={isBusy}
              onClick={() => setConfirmAction("check")}
            >
              {bulkCheck.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run Check
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={isBusy}
              onClick={() => setConfirmAction("ban-delete")}
            >
              {bulkBanDelete.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Ban className="size-4" />
              )}
              Ban & Delete
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={isBusy}
              onClick={() => setConfirmAction("delete")}
            >
              {bulkDelete.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmAction && confirmMessages[confirmAction] && (
        <Dialog
          open={!!confirmAction}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmMessages[confirmAction].title}</DialogTitle>
              <DialogDescription>
                {confirmMessages[confirmAction].description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmAction === "check" ? "default" : "destructive"}
                onClick={executeAction}
                disabled={isBusy}
              >
                {isBusy && <Loader2 className="size-4 animate-spin" />}
                {confirmMessages[confirmAction].button}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function MonitorRow({
  monitor: m,
  now,
  selectMode,
  selected,
  onToggleSelect,
}: {
  monitor: MonitorData;
  now: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const status = getMonitorStatus(m);
  const sslDays = m.sslExpiresAt ? daysUntil(m.sslExpiresAt, now) : null;
  const failed = m.history.filter((s) => s === "down").length;
  const checked = m.history.filter((s) => s !== "none").length;

  const nameCell = (
    <div className="flex min-w-0 max-w-[340px] flex-col gap-0.5">
      <span className="truncate text-sm font-medium" title={m.name}>
        {m.name}
      </span>
      <span className="truncate font-mono text-[11px] text-muted-foreground" title={m.url}>
        {m.url}
      </span>
    </div>
  );

  return (
    <tr
      onClick={selectMode ? () => onToggleSelect(m.id) : undefined}
      className={cn(
        "border-b transition-colors last:border-b-0 hover:bg-muted/60",
        status === "down" && "bg-status-down/5",
        selectMode && "cursor-pointer",
        selected && "bg-muted"
      )}
    >
      {selectMode && (
        <td className="px-3 py-2.5">
          <Checkbox
            checked={selected}
            aria-label={`Select ${m.name}`}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={() => onToggleSelect(m.id)}
          />
        </td>
      )}
      <td className="whitespace-nowrap px-3 py-2.5">
        <span
          className={cn(
            "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 font-mono text-[11px] font-medium tracking-wide",
            STATUS_BADGE[status]
          )}
        >
          <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
          {STATUS_LABEL[status]}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {selectMode ? (
          nameCell
        ) : (
          <Link href={`/monitors/${m.id}`} className="block hover:underline">
            {nameCell}
          </Link>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div
          role="img"
          aria-label={
            checked === 0 ? "No checks in the last hour" : `${failed} failed of ${checked} checks`
          }
          className="flex h-5 items-center gap-[2px]"
        >
          {m.history.map((slot, i) => (
            <span
              key={i}
              className={cn(
                "w-1 rounded-[1px]",
                slot === "up" && "h-4 bg-status-up/75",
                slot === "down" && "h-5 bg-status-down",
                slot === "none" && "h-4 bg-border"
              )}
            />
          ))}
        </div>
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-3 py-2.5 text-right font-mono",
          m.lastResponseTime != null && m.lastResponseTime > 1000 && "text-status-pending"
        )}
      >
        {status === "paused" || m.lastResponseTime == null
          ? "—"
          : `${m.lastResponseTime.toLocaleString()} ms`}
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-3 py-2.5 text-right font-mono font-medium",
          m.uptime24h == null && "text-muted-foreground",
          m.uptime24h != null && m.uptime24h < 99 && "text-status-down",
          m.uptime24h != null && m.uptime24h >= 99 && m.uptime24h < 99.9 && "text-status-pending"
        )}
      >
        {m.uptime24h == null
          ? "—"
          : `${m.uptime24h === 100 ? "100" : m.uptime24h.toFixed(1)}%`}
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-3 py-2.5 text-right font-mono text-muted-foreground",
          sslDays != null && sslDays <= 7 && "text-status-down",
          sslDays != null && sslDays > 7 && sslDays <= SSL_WARNING_DAYS && "text-status-pending"
        )}
      >
        {sslDays == null ? "—" : `${sslDays} d`}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-muted-foreground">
        {m.lastCheckedAt ? formatAgo(m.lastCheckedAt, now) : "—"}
      </td>
    </tr>
  );
}
