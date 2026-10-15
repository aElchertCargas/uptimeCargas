"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  Trash2,
  Loader2,
  RefreshCw,
  Ban,
  CheckCircle2,
  AlertTriangle,
  ArrowUpDown,
  Search,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SyncData {
  toAdd: { customerName: string; publicUrl: string }[];
  toDelete: { id: string; name: string; url: string }[];
  excluded: { customerName: string; publicUrl: string; matchedPattern: string }[];
  urlMismatches: {
    id: string;
    customerName: string;
    currentUrl: string;
    syncedUrl: string;
  }[];
  summary: {
    totalCustomers: number;
    totalMonitors: number;
    toAddCount: number;
    toDeleteCount: number;
    excludedCount: number;
    urlMismatchCount: number;
  };
}

type SortDir = "asc" | "desc";

function toggleSort(current: SortDir): SortDir {
  return current === "asc" ? "desc" : "asc";
}

function cmp(a: string, b: string, dir: SortDir): number {
  const result = a.localeCompare(b, undefined, { sensitivity: "base" });
  return dir === "asc" ? result : -result;
}

export default function SyncPage() {
  const queryClient = useQueryClient();

  // Selection uses stable keys: publicUrl for toAdd, id for toDelete
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set());

  // Search
  const [addSearch, setAddSearch] = useState("");
  const [deleteSearch, setDeleteSearch] = useState("");
  const [excludedSearch, setExcludedSearch] = useState("");
  const [mismatchSearch, setMismatchSearch] = useState("");

  // Sort
  const [addSort, setAddSort] = useState<SortDir>("asc");
  const [deleteSort, setDeleteSort] = useState<SortDir>("asc");
  const [excludedSort, setExcludedSort] = useState<SortDir>("asc");
  const [mismatchSort, setMismatchSort] = useState<SortDir>("asc");

  const { data, isLoading, error, refetch, isFetching } = useQuery<SyncData>({
    queryKey: ["sync"],
    queryFn: async () => {
      const res = await fetch("/api/sync");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to sync");
      }
      return res.json();
    },
  });

  // Filtered + sorted lists
  const filteredToAdd = useMemo(() => {
    if (!data) return [];
    const q = addSearch.toLowerCase();
    return data.toAdd
      .filter((c) => !q || c.customerName.toLowerCase().includes(q) || c.publicUrl.toLowerCase().includes(q))
      .sort((a, b) => cmp(a.customerName, b.customerName, addSort));
  }, [data, addSearch, addSort]);

  const filteredToDelete = useMemo(() => {
    if (!data) return [];
    const q = deleteSearch.toLowerCase();
    return data.toDelete
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q))
      .sort((a, b) => cmp(a.name, b.name, deleteSort));
  }, [data, deleteSearch, deleteSort]);

  const filteredExcluded = useMemo(() => {
    if (!data) return [];
    const q = excludedSearch.toLowerCase();
    return data.excluded
      .filter((e) => !q || e.customerName.toLowerCase().includes(q) || e.publicUrl.toLowerCase().includes(q) || e.matchedPattern.toLowerCase().includes(q))
      .sort((a, b) => cmp(a.customerName, b.customerName, excludedSort));
  }, [data, excludedSearch, excludedSort]);

  const filteredUrlMismatches = useMemo(() => {
    if (!data) return [];
    const q = mismatchSearch.toLowerCase();
    return data.urlMismatches
      .filter((m) =>
        !q ||
        m.customerName.toLowerCase().includes(q) ||
        m.currentUrl.toLowerCase().includes(q) ||
        m.syncedUrl.toLowerCase().includes(q)
      )
      .sort((a, b) => cmp(a.customerName, b.customerName, mismatchSort));
  }, [data, mismatchSearch, mismatchSort]);

  const bulkAddMutation = useMutation({
    mutationFn: async (monitors: { name: string; url: string }[]) => {
      const res = await fetch("/api/sync/bulk-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitors }),
      });
      if (!res.ok) throw new Error("Failed to add monitors");
      return res.json();
    },
    onSuccess: (result) => {
      toast.success(`Added ${result.created} monitor(s)`);
      setSelectedToAdd(new Set());
      queryClient.invalidateQueries({ queryKey: ["sync"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/sync/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Failed to delete monitors");
      return res.json();
    },
    onSuccess: (result) => {
      toast.success(`Deleted ${result.deleted} monitor(s)`);
      setSelectedToDelete(new Set());
      queryClient.invalidateQueries({ queryKey: ["sync"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const approveUrlMutation = useMutation({
    mutationFn: async (mismatch: SyncData["urlMismatches"][number]) => {
      const res = await fetch(`/api/monitors/${mismatch.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: mismatch.syncedUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to approve URL");
      }

      return res.json();
    },
    onSuccess: (_updatedMonitor, mismatch) => {
      toast.success(`Updated URL for ${mismatch.customerName}`);
      queryClient.invalidateQueries({ queryKey: ["sync"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["monitor", mismatch.id] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to approve URL");
    },
  });

  const handleAddSelected = useCallback(() => {
    if (!data) return;
    const monitors = data.toAdd
      .filter((c) => selectedToAdd.has(c.publicUrl))
      .map((c) => ({ name: c.customerName, url: c.publicUrl }));
    if (monitors.length === 0) return;
    bulkAddMutation.mutate(monitors);
  }, [data, selectedToAdd, bulkAddMutation]);

  const handleDeleteSelected = useCallback(() => {
    if (!data) return;
    const ids = data.toDelete
      .filter((m) => selectedToDelete.has(m.id))
      .map((m) => m.id);
    if (ids.length === 0) return;
    bulkDeleteMutation.mutate(ids);
  }, [data, selectedToDelete, bulkDeleteMutation]);

  // "Select all" checks only visible (filtered) rows
  const allAddVisible = useMemo(() => {
    if (filteredToAdd.length === 0) return false;
    return filteredToAdd.every((c) => selectedToAdd.has(c.publicUrl));
  }, [filteredToAdd, selectedToAdd]);

  const allDeleteVisible = useMemo(() => {
    if (filteredToDelete.length === 0) return false;
    return filteredToDelete.every((m) => selectedToDelete.has(m.id));
  }, [filteredToDelete, selectedToDelete]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">API Sync</h1>
        <Card className="border-destructive/50">
          <CardContent className="py-6">
            <p className="text-destructive">
              {error instanceof Error ? error.message : "Failed to load sync data"}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="size-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Sync</h1>
          <p className="text-sm text-muted-foreground">
            Compare Energy Customers API with existing monitors
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <span className="text-sm text-muted-foreground">API Customers</span>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-semibold">{data.summary.totalCustomers}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ArrowDownToLine className="size-3.5" /> To Add
            </span>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-semibold text-[var(--color-status-up)]">
              {data.summary.toAddCount}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Trash2 className="size-3.5" /> Stale
            </span>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-semibold text-[var(--color-status-down)]">
              {data.summary.toDeleteCount}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <RefreshCw className="size-3.5" /> URL Audit
            </span>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-semibold text-amber-500">
              {data.summary.urlMismatchCount}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Ban className="size-3.5" /> Excluded
            </span>
          </CardHeader>
          <CardContent>
            <span className="font-mono text-2xl font-semibold text-[var(--color-status-pending)]">
              {data.summary.excludedCount}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* To Add */}
      {data.toAdd.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <CheckCircle2 className="size-4 text-[var(--color-status-up)]" />
              New Customers to Add ({data.toAdd.length})
            </CardTitle>
            <Button
              onClick={handleAddSelected}
              disabled={selectedToAdd.size === 0 || bulkAddMutation.isPending}
            >
              {bulkAddMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              <ArrowDownToLine className="size-4" />
              Add Selected ({selectedToAdd.size})
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                className="pl-9 font-mono text-sm"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allAddVisible}
                      onCheckedChange={(checked) => {
                        setSelectedToAdd((prev) => {
                          const next = new Set(prev);
                          for (const c of filteredToAdd) {
                            if (checked) next.add(c.publicUrl);
                            else next.delete(c.publicUrl);
                          }
                          return next;
                        });
                      }}
                    />
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => setAddSort(toggleSort(addSort))}
                      className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
                    >
                      Customer
                      <ArrowUpDown className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead className="font-mono">URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredToAdd.map((c) => (
                  <TableRow key={c.publicUrl}>
                    <TableCell>
                      <Checkbox
                        checked={selectedToAdd.has(c.publicUrl)}
                        onCheckedChange={(checked) => {
                          setSelectedToAdd((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(c.publicUrl);
                            else next.delete(c.publicUrl);
                            return next;
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{c.customerName}</TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                      {c.publicUrl}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredToAdd.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No matches
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* URL Mismatches */}
      {data.urlMismatches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <RefreshCw className="size-4 text-amber-500" />
              URL Mismatches ({data.urlMismatches.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search mismatches..."
                value={mismatchSearch}
                onChange={(e) => setMismatchSearch(e.target.value)}
                className="pl-9 font-mono text-sm"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button
                      onClick={() => setMismatchSort(toggleSort(mismatchSort))}
                      className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
                    >
                      Customer
                      <ArrowUpDown className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead className="font-mono">Current URL</TableHead>
                  <TableHead className="font-mono">API URL</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUrlMismatches.map((mismatch) => (
                  <TableRow key={mismatch.id}>
                    <TableCell className="font-medium">{mismatch.customerName}</TableCell>
                    <TableCell className="max-w-sm truncate font-mono text-xs text-muted-foreground">
                      {mismatch.currentUrl}
                    </TableCell>
                    <TableCell className="max-w-sm truncate font-mono text-xs">
                      {mismatch.syncedUrl}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={mismatch.syncedUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            <ExternalLink className="size-4" />
                            Review
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approveUrlMutation.mutate(mismatch)}
                          disabled={approveUrlMutation.isPending}
                        >
                          {approveUrlMutation.isPending &&
                            approveUrlMutation.variables?.id === mismatch.id && (
                              <Loader2 className="size-4 animate-spin" />
                            )}
                          Approve
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredUrlMismatches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No matches
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* To Delete */}
      {data.toDelete.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle className="size-4 text-[var(--color-status-down)]" />
              Stale Monitors ({data.toDelete.length})
            </CardTitle>
            <Button
              variant="destructive"
              onClick={handleDeleteSelected}
              disabled={selectedToDelete.size === 0 || bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              <Trash2 className="size-4" />
              Delete Selected ({selectedToDelete.size})
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search monitors..."
                value={deleteSearch}
                onChange={(e) => setDeleteSearch(e.target.value)}
                className="pl-9 font-mono text-sm"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allDeleteVisible}
                      onCheckedChange={(checked) => {
                        setSelectedToDelete((prev) => {
                          const next = new Set(prev);
                          for (const m of filteredToDelete) {
                            if (checked) next.add(m.id);
                            else next.delete(m.id);
                          }
                          return next;
                        });
                      }}
                    />
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => setDeleteSort(toggleSort(deleteSort))}
                      className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
                    >
                      Name
                      <ArrowUpDown className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead className="font-mono">URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredToDelete.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedToDelete.has(m.id)}
                        onCheckedChange={(checked) => {
                          setSelectedToDelete((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(m.id);
                            else next.delete(m.id);
                            return next;
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">
                      {m.url}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredToDelete.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No matches
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Excluded */}
      {data.excluded.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Ban className="size-4 text-[var(--color-status-pending)]" />
              Excluded by Pattern ({data.excluded.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search excluded..."
                value={excludedSearch}
                onChange={(e) => setExcludedSearch(e.target.value)}
                className="pl-9 font-mono text-sm"
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button
                      onClick={() => setExcludedSort(toggleSort(excludedSort))}
                      className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
                    >
                      Customer
                      <ArrowUpDown className="size-3" />
                    </button>
                  </TableHead>
                  <TableHead className="font-mono">URL</TableHead>
                  <TableHead className="font-mono">Matched Pattern</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExcluded.map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{e.customerName}</TableCell>
                    <TableCell className="max-w-sm truncate font-mono text-xs text-muted-foreground">
                      {e.publicUrl}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.matchedPattern}</TableCell>
                  </TableRow>
                ))}
                {filteredExcluded.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                      No matches
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.toAdd.length === 0 &&
        data.toDelete.length === 0 &&
        data.excluded.length === 0 &&
        data.urlMismatches.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              Everything is in sync. No changes needed.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
