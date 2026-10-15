"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Send,
  Loader2,
  X,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection, SettingRow } from "@/components/settings/section";

// ─── Notification Channel Types ──────────────────────────────────────────────

type NotificationChannelType = "webhook" | "pushover" | "teams";

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

interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  config: WebhookConfig | PushoverConfig | TeamsConfig;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
}

const PRIORITY_OPTIONS = [
  { value: "-2", label: "Lowest (-2)" },
  { value: "-1", label: "Low (-1)" },
  { value: "0", label: "Normal (0)" },
  { value: "1", label: "High (1)" },
  { value: "2", label: "Emergency (2)" },
];

// ─── Excluded Pattern Types ──────────────────────────────────────────────────

interface ExcludedPattern {
  id: string;
  pattern: string;
  createdAt: string;
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function fetchChannels(): Promise<NotificationChannel[]> {
  const res = await fetch("/api/notifications");
  if (!res.ok) throw new Error("Failed to fetch channels");
  return res.json();
}

async function createChannel(data: {
  name: string;
  type: NotificationChannelType;
  config: WebhookConfig | PushoverConfig | TeamsConfig;
  enabled: boolean;
  isDefault?: boolean;
}): Promise<NotificationChannel> {
  const res = await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to create channel");
  }
  return res.json();
}

async function updateChannel(
  id: string,
  data: Partial<NotificationChannel>
): Promise<NotificationChannel> {
  const res = await fetch(`/api/notifications/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to update channel");
  }
  return res.json();
}

async function deleteChannel(id: string): Promise<void> {
  const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete channel");
}

async function testChannel(id: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/notifications/${id}/test`, {
    method: "POST",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Test failed");
  return data;
}

async function fetchPatterns(): Promise<ExcludedPattern[]> {
  const res = await fetch("/api/excluded-patterns");
  if (!res.ok) throw new Error("Failed to fetch patterns");
  return res.json();
}

// ─── Channel Form ────────────────────────────────────────────────────────────

const DEFAULT_TEAMS_BODY = `{
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "type": "AdaptiveCard",
  "version": "1.4",
  "body": [
    { "type": "TextBlock", "weight": "bolder", "text": "{{monitorName}} is {{status}}" },
    { "type": "FactSet", "facts": [{ "title": "URL", "value": "{{monitorUrl}}" }] },
    { "type": "TextBlock", "text": "{{message}}", "wrap": true }
  ]
}`;

function ChannelForm({
  channel,
  onSuccess,
  onCancel,
}: {
  channel?: NotificationChannel | null;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!channel;

  const [name, setName] = useState(channel?.name ?? "");
  const [type, setType] = useState<NotificationChannelType>(
    channel?.type ?? "webhook"
  );
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(channel?.isDefault ?? false);

  // Webhook fields
  const [url, setUrl] = useState(
    (channel?.type === "webhook" ? (channel.config as WebhookConfig).url : "") ?? ""
  );

  // Pushover fields
  const [userKey, setUserKey] = useState(
    (channel?.type === "pushover"
      ? (channel.config as PushoverConfig).userKey
      : "") ?? ""
  );
  const [appToken, setAppToken] = useState(
    (channel?.type === "pushover"
      ? (channel.config as PushoverConfig).appToken
      : "") ?? ""
  );
  const [priority, setPriority] = useState<string>(
    String(
      (channel?.type === "pushover"
        ? (channel.config as PushoverConfig).priority ?? 0
        : 0)
    )
  );
  const [sound, setSound] = useState(
    (channel?.type === "pushover"
      ? (channel.config as PushoverConfig).sound
      : "") ?? ""
  );
  const [device, setDevice] = useState(
    (channel?.type === "pushover"
      ? (channel.config as PushoverConfig).device
      : "") ?? ""
  );

  // Teams fields
  const teamsConfig = channel?.type === "teams" ? (channel.config as TeamsConfig) : null;
  const [teamsUrl, setTeamsUrl] = useState(teamsConfig?.url ?? "");
  const [teamsBodyType, setTeamsBodyType] = useState<"adaptive-card" | "adaptive-card-message" | "custom">(
    teamsConfig?.bodyType ?? "adaptive-card"
  );
  const [teamsCustomBody, setTeamsCustomBody] = useState(
    teamsConfig?.customBody ?? DEFAULT_TEAMS_BODY
  );
  const [teamsHeaders, setTeamsHeaders] = useState(
    teamsConfig?.headers ? JSON.stringify(teamsConfig.headers, null, 2) : ""
  );

  const createMutation = useMutation({
    mutationFn: createChannel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Channel created");
      onSuccess();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NotificationChannel> }) =>
      updateChannel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Channel updated");
      onSuccess();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let config: WebhookConfig | PushoverConfig | TeamsConfig;

    if (type === "webhook") {
      if (!url.trim()) { toast.error("URL is required"); return; }
      config = { url };
    } else if (type === "pushover") {
      if (!userKey.trim() || !appToken.trim()) {
        toast.error("User Key and App Token are required");
        return;
      }
      config = {
        userKey,
        appToken,
        priority: parseInt(priority, 10),
        ...(sound && { sound }),
        ...(device && { device }),
      };
    } else {
      if (!teamsUrl.trim()) { toast.error("Webhook URL is required"); return; }
      let parsedHeaders: Record<string, string> | undefined;
      if (teamsHeaders.trim()) {
        try {
          parsedHeaders = JSON.parse(teamsHeaders);
        } catch {
          toast.error("Headers must be valid JSON");
          return;
        }
      }
      if (teamsBodyType === "custom" && teamsCustomBody.trim()) {
        try {
          JSON.parse(teamsCustomBody);
        } catch {
          toast.error("Custom body must be valid JSON");
          return;
        }
      }
      config = {
        url: teamsUrl,
        bodyType: teamsBodyType,
        ...(teamsBodyType === "custom" && teamsCustomBody && { customBody: teamsCustomBody }),
        ...(parsedHeaders && { headers: parsedHeaders }),
      };
    }

    if (isEditing && channel) {
      updateMutation.mutate({
        id: channel.id,
        data: { name: name.trim(), type, config, enabled, isDefault },
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        type,
        config,
        enabled,
        isDefault,
      });
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="channel-name">Name</Label>
        <Input
          id="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Teams Alerts"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Type</Label>
        <Select
          value={type}
          onValueChange={(v) => setType(v as NotificationChannelType)}
          disabled={isEditing}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="webhook">Webhook</SelectItem>
            <SelectItem value="pushover">Pushover</SelectItem>
            <SelectItem value="teams">Microsoft Teams</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {type === "webhook" && (
        <div className="space-y-2">
          <Label htmlFor="webhook-url">URL</Label>
          <Input
            id="webhook-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/..."
          />
        </div>
      )}

      {type === "pushover" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="pushover-userKey">User Key</Label>
            <Input
              id="pushover-userKey"
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              placeholder="Your Pushover user key"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pushover-appToken">App Token</Label>
            <Input
              id="pushover-appToken"
              value={appToken}
              onChange={(e) => setAppToken(e.target.value)}
              placeholder="Your Pushover application token"
            />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pushover-sound">Sound (optional)</Label>
            <Input
              id="pushover-sound"
              value={sound}
              onChange={(e) => setSound(e.target.value)}
              placeholder="pushover, bike, bugle, etc."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pushover-device">Device (optional)</Label>
            <Input
              id="pushover-device"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              placeholder="Device name"
            />
          </div>
        </>
      )}

      {type === "teams" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="teams-url">Webhook URL</Label>
            <Input
              id="teams-url"
              type="url"
              value={teamsUrl}
              onChange={(e) => setTeamsUrl(e.target.value)}
              placeholder="https://outlook.office.com/webhook/..."
            />
          </div>
          <div className="space-y-2">
            <Label>Request Body Type</Label>
            <Select
              value={teamsBodyType}
              onValueChange={(v) => setTeamsBodyType(v as "adaptive-card" | "adaptive-card-message" | "custom")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="adaptive-card">Adaptive Card (default)</SelectItem>
                <SelectItem value="adaptive-card-message">Adaptive Card in message envelope (Power Automate Workflows)</SelectItem>
                <SelectItem value="custom">Custom Body</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {teamsBodyType === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="teams-body">Custom HTTP Body (JSON)</Label>
              <Textarea
                id="teams-body"
                value={teamsCustomBody}
                onChange={(e) => setTeamsCustomBody(e.target.value)}
                placeholder={DEFAULT_TEAMS_BODY}
                className="min-h-[160px] font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Available placeholders: {"{{monitorName}}"}, {"{{monitorUrl}}"}, {"{{status}}"}, {"{{message}}"}, {"{{timestamp}}"}, {"{{zendeskDisplay}}"}, {"{{zendeskUrl}}"}, {"{{zendeskUpdated}}"}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="teams-headers">Custom Headers (JSON, optional)</Label>
            <Textarea
              id="teams-headers"
              value={teamsHeaders}
              onChange={(e) => setTeamsHeaders(e.target.value)}
              placeholder={'{\n  "X-Custom-Header": "value"\n}'}
              className="min-h-[80px] font-mono text-xs"
            />
          </div>
        </>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch id="form-enabled" checked={enabled} onCheckedChange={setEnabled} />
          <Label htmlFor="form-enabled">Enabled</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="form-default" checked={isDefault} onCheckedChange={setIsDefault} />
          <Label htmlFor="form-default">Default channel</Label>
        </div>
      </div>

      <DialogFooter className="gap-2 sm:gap-0 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {isEditing ? "Save" : "Add Channel"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Delete Confirmation ─────────────────────────────────────────────────────

function DeleteConfirmDialog({
  channel,
  onDeleted,
  onCancel,
}: {
  channel: NotificationChannel;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => deleteChannel(channel.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Channel deleted");
      onDeleted();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Are you sure you want to delete &quot;{channel.name}&quot;? This action cannot
        be undone.
      </p>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={onCancel} disabled={deleteMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Delete
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Channel Card ────────────────────────────────────────────────────────────

function getChannelDescription(channel: NotificationChannel): string {
  switch (channel.type) {
    case "webhook":
      return (channel.config as WebhookConfig).url;
    case "pushover":
      return `User: ${(channel.config as PushoverConfig).userKey.slice(0, 8)}…`;
    case "teams": {
      const tc = channel.config as TeamsConfig;
      const bodyLabel =
        tc.bodyType === "custom"
          ? "Custom body"
          : tc.bodyType === "adaptive-card-message"
            ? "Adaptive Card (message envelope)"
            : "Adaptive Card";
      return `${bodyLabel} → ${tc.url.slice(0, 50)}…`;
    }
    default:
      return "";
  }
}

function ChannelCard({ channel }: { channel: NotificationChannel }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<NotificationChannel>) =>
      updateChannel(channel.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const testMutation = useMutation({
    mutationFn: () => testChannel(channel.id),
    onSuccess: (data) => {
      toast.success(data.success ? "Test notification sent" : "Test failed");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Test failed"),
  });

  const handleToggleEnabled = (checked: boolean) => {
    updateMutation.mutate({ enabled: checked });
  };

  return (
    <Card className="border-l-4 border-l-muted hover:border-l-primary/50 transition-colors">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-base truncate">{channel.name}</CardTitle>
            <Badge variant="secondary" className="font-mono text-xs capitalize">
              {channel.type === "teams" ? "Teams" : channel.type}
            </Badge>
            {channel.isDefault && (
              <Badge className="text-xs">Default</Badge>
            )}
          </div>
          <CardDescription className="mt-1 text-xs font-mono truncate">
            {getChannelDescription(channel)}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={channel.enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={updateMutation.isPending}
          />
        </div>
      </CardHeader>
      <CardContent className="flex items-center gap-2 px-4 pb-3 pt-0">
        <Button
          size="sm"
          variant="outline"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
        >
          {testMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Test
        </Button>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Pencil className="size-4" />
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Channel</DialogTitle>
              <DialogDescription>
                Update the notification channel settings.
              </DialogDescription>
            </DialogHeader>
            <ChannelForm
              channel={channel}
              onSuccess={() => setEditOpen(false)}
              onCancel={() => setEditOpen(false)}
            />
          </DialogContent>
        </Dialog>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive">
              <Trash2 className="size-4" />
              Delete
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Channel</DialogTitle>
              <DialogDescription>
                This will permanently remove the notification channel.
              </DialogDescription>
            </DialogHeader>
            <DeleteConfirmDialog
              channel={channel}
              onDeleted={() => setDeleteOpen(false)}
              onCancel={() => setDeleteOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ─── Data Retention Section ──────────────────────────────────────────────────

function DataRetentionSection() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState("");

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const loaded = !isLoading && settings;
  const currentDays = settings?.retentionDays ?? "90";

  const saveMutation = useMutation({
    mutationFn: async (retentionDays: string) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Retention updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const runCleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/cron/cleanup", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Cleanup failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(`Pruned ${data.deleted} old check(s)`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleSave = () => {
    const val = parseInt(days || currentDays, 10);
    if (isNaN(val) || val < 1) {
      toast.error("Enter a positive number of days");
      return;
    }
    saveMutation.mutate(String(val));
  };

  return (
    <SettingsSection
      id="retention"
      title="Data Retention"
      description="Old check history is pruned automatically every day."
      footer={
        loaded ? (
          <>
            <span>
              Keeping <span className="font-mono font-medium">{currentDays}</span> days of history
            </span>
            {settings?.lastCleanupAt && (
              <span>
                Last pruned{" "}
                <span className="font-mono font-medium">
                  {new Date(settings.lastCleanupAt).toLocaleString()}
                </span>
                {settings?.lastCleanupCount && (
                  <> · <span className="font-mono font-medium">{settings.lastCleanupCount}</span> removed</>
                )}
              </span>
            )}
          </>
        ) : undefined
      }
    >
      <SettingRow
        label="Check history retention"
        htmlFor="retention-days"
        help="Checks older than this many days are deleted."
      >
        <Input
          id="retention-days"
          type="number"
          min={1}
          className="w-28 font-mono"
          placeholder={loaded ? currentDays : "90"}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          disabled={isLoading}
        />
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending || isLoading}
        >
          {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        <Button
          variant="outline"
          onClick={() => runCleanupMutation.mutate()}
          disabled={runCleanupMutation.isPending}
        >
          {runCleanupMutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Run Cleanup Now
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

// ─── Heartbeat Interval Section ──────────────────────────────────────────────

function HeartbeatIntervalSection() {
  const queryClient = useQueryClient();
  const [seconds, setSeconds] = useState("");

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const loaded = !isLoading && settings;
  const currentInterval = settings?.defaultInterval ?? "120";

  const saveMutation = useMutation({
    mutationFn: async (interval: number) => {
      const [settingsRes, bulkRes] = await Promise.all([
        fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultInterval: String(interval) }),
        }),
        fetch("/api/monitors/bulk-interval", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: "all", interval }),
        }),
      ]);
      if (!settingsRes.ok) throw new Error("Failed to save setting");
      if (!bulkRes.ok) throw new Error("Failed to update monitors");
      return bulkRes.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      toast.success(`Updated ${data.updated} monitor(s) to new interval`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleSave = () => {
    const val = parseInt(seconds || currentInterval, 10);
    if (isNaN(val) || val < 10) {
      toast.error("Interval must be at least 10 seconds");
      return;
    }
    saveMutation.mutate(val);
  };

  return (
    <SettingRow
      label="Check interval"
      htmlFor="heartbeat-interval"
      help={
        <>
          Seconds between checks. Saving applies to all existing monitors.
          {loaded && (
            <>
              {" "}Current: <span className="font-mono font-medium">{currentInterval}s</span>
            </>
          )}
        </>
      }
    >
      <Input
        id="heartbeat-interval"
        type="number"
        min={10}
        className="w-28 font-mono"
        placeholder={loaded ? currentInterval : "120"}
        value={seconds}
        onChange={(e) => setSeconds(e.target.value)}
        disabled={isLoading}
      />
      <Button
        onClick={handleSave}
        disabled={saveMutation.isPending || isLoading}
      >
        {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
        Save &amp; Apply to All
      </Button>
    </SettingRow>
  );
}

// ─── Alert Delay Section ─────────────────────────────────────────────────────

function AlertDelaySection() {
  const queryClient = useQueryClient();
  const [seconds, setSeconds] = useState("");

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const loaded = !isLoading && settings;
  const currentDelay = settings?.alertDelaySeconds ?? "300";

  const saveMutation = useMutation({
    mutationFn: async (alertDelaySeconds: string) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertDelaySeconds }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Alert delay updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleSave = () => {
    const val = parseInt(seconds || currentDelay, 10);
    if (isNaN(val) || val < 0) {
      toast.error("Enter a non-negative number of seconds");
      return;
    }
    saveMutation.mutate(String(val));
  };

  const displayMinutes = Math.floor(parseInt(currentDelay, 10) / 60);
  const displayRemainder = parseInt(currentDelay, 10) % 60;
  const displayText =
    displayMinutes > 0
      ? displayRemainder > 0
        ? `${displayMinutes}m ${displayRemainder}s`
        : `${displayMinutes}m`
      : `${currentDelay}s`;

  return (
    <SettingRow
      label="Down alert delay"
      htmlFor="alert-delay"
      help={
        <>
          Seconds a monitor must stay down before alerting. Use 0 for immediate alerts.
          {loaded && (
            <>
              {" "}Current: <span className="font-mono font-medium">{displayText}</span>
            </>
          )}
        </>
      }
    >
      <Input
        id="alert-delay"
        type="number"
        min={0}
        className="w-28 font-mono"
        placeholder={loaded ? currentDelay : "300"}
        value={seconds}
        onChange={(e) => setSeconds(e.target.value)}
        disabled={isLoading}
      />
      <Button
        onClick={handleSave}
        disabled={saveMutation.isPending || isLoading}
      >
        {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
        Save
      </Button>
    </SettingRow>
  );
}

function FalseDownProtectionSection() {
  const queryClient = useQueryClient();
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [minAffectedMonitorsDraft, setMinAffectedMonitorsDraft] = useState<
    string | null
  >(null);
  const [minAffectedPercentDraft, setMinAffectedPercentDraft] = useState<
    string | null
  >(null);
  const [minNetworkErrorPercentDraft, setMinNetworkErrorPercentDraft] = useState<
    string | null
  >(null);

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const enabled =
    enabledDraft ?? (settings?.falseDownProtectionEnabled !== "false");
  const minAffectedMonitors =
    minAffectedMonitorsDraft ??
    settings?.falseDownProtectionMinAffectedMonitors ??
    "8";
  const minAffectedPercent =
    minAffectedPercentDraft ??
    String(
      Math.round(
        parseFloat(settings?.falseDownProtectionMinAffectedRatio ?? "0.2") * 100
      )
    );
  const minNetworkErrorPercent =
    minNetworkErrorPercentDraft ??
    String(
      Math.round(
        parseFloat(
          settings?.falseDownProtectionMinNetworkErrorRatio ?? "0.75"
        ) * 100
      )
    );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const minAffected = parseInt(minAffectedMonitors || "0", 10);
      const affectedPercent = parseInt(minAffectedPercent || "0", 10);
      const networkPercent = parseInt(minNetworkErrorPercent || "0", 10);

      if (isNaN(minAffected) || minAffected < 1) {
        throw new Error("Minimum affected monitors must be at least 1");
      }

      if (isNaN(affectedPercent) || affectedPercent < 1 || affectedPercent > 100) {
        throw new Error("Affected percentage must be between 1 and 100");
      }

      if (isNaN(networkPercent) || networkPercent < 1 || networkPercent > 100) {
        throw new Error("Network error percentage must be between 1 and 100");
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          falseDownProtectionEnabled: String(enabled),
          falseDownProtectionMinAffectedMonitors: String(minAffected),
          falseDownProtectionMinAffectedRatio: String(affectedPercent / 100),
          falseDownProtectionMinNetworkErrorRatio: String(networkPercent / 100),
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("False down protection updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const loaded = !isLoading && settings;

  return (
    <>
      <SettingRow
        label="False down protection"
        help="Suppress new down incidents when many monitors fail with the same checker-side network error. Raw checks are still recorded."
      >
        <Switch
          checked={enabled}
          onCheckedChange={setEnabledDraft}
          disabled={isLoading || saveMutation.isPending}
        />
      </SettingRow>
      <SettingRow
        label="Min affected monitors"
        htmlFor="false-down-min-affected"
        help="Fewest monitors that must fail together."
      >
        <Input
          id="false-down-min-affected"
          type="number"
          min={1}
          className="w-28 font-mono"
          value={minAffectedMonitors}
          onChange={(e) => setMinAffectedMonitorsDraft(e.target.value)}
          disabled={isLoading}
        />
      </SettingRow>
      <SettingRow
        label="Min affected percentage"
        htmlFor="false-down-affected-ratio"
        help="Share of all monitors that must fail together."
      >
        <Input
          id="false-down-affected-ratio"
          type="number"
          min={1}
          max={100}
          className="w-28 font-mono"
          value={minAffectedPercent}
          onChange={(e) => setMinAffectedPercentDraft(e.target.value)}
          disabled={isLoading}
        />
      </SettingRow>
      <SettingRow
        label="Required network-error percentage"
        htmlFor="false-down-network-ratio"
        help="Share of failures that must look like network errors."
      >
        <Input
          id="false-down-network-ratio"
          type="number"
          min={1}
          max={100}
          className="w-28 font-mono"
          value={minNetworkErrorPercent}
          onChange={(e) => setMinNetworkErrorPercentDraft(e.target.value)}
          disabled={isLoading}
        />
      </SettingRow>
      <div className="flex items-center justify-between gap-3 bg-muted/30 px-6 py-3">
        <p className="text-xs text-muted-foreground">
          {loaded
            ? `Current: ${minAffectedMonitors} monitor(s), ${minAffectedPercent}% affected, ${minNetworkErrorPercent}% network-style failures.`
            : "Loading current thresholds..."}
        </p>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isLoading}
        >
          {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </>
  );
}

// ─── SSL Alert Section ───────────────────────────────────────────────────────

function SslAlertSection() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState("");

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const loaded = !isLoading && settings;
  const currentDays = settings?.sslAlertDays ?? "1";

  const saveMutation = useMutation({
    mutationFn: async (sslAlertDays: string) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sslAlertDays }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("SSL alert threshold updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const runSslCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/ssl-check", {
        method: "POST",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(
          typeof error.error === "string" ? error.error : "SSL check failed"
        );
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success(`Checked ${data.checked} certificate(s), ${data.alerted} alert(s) sent`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleSave = () => {
    const val = parseInt(days || currentDays, 10);
    if (isNaN(val) || val < 1) {
      toast.error("Enter at least 1 day");
      return;
    }
    saveMutation.mutate(String(val));
  };

  return (
    <SettingsSection
      id="ssl"
      title="SSL Certificate Alerts"
      description="Certificates are checked once per day."
    >
      <SettingRow
        label="Days before expiry"
        htmlFor="ssl-alert-days"
        help={
          <>
            Alert when a certificate expires within this many days.
            {loaded && (
              <>
                {" "}Current: <span className="font-mono font-medium">{currentDays}</span> day{currentDays === "1" ? "" : "s"}
              </>
            )}
          </>
        }
      >
        <Input
          id="ssl-alert-days"
          type="number"
          min={1}
          className="w-28 font-mono"
          placeholder={loaded ? currentDays : "1"}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          disabled={isLoading}
        />
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending || isLoading}
        >
          {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
        <Button
          variant="outline"
          onClick={() => runSslCheckMutation.mutate()}
          disabled={runSslCheckMutation.isPending}
        >
          {runSslCheckMutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Check Now
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

// ─── Excluded Patterns Section ───────────────────────────────────────────────

function ExcludedPatternsSection() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newPattern, setNewPattern] = useState("");

  const { data: patterns, isLoading } = useQuery({
    queryKey: ["excluded-patterns"],
    queryFn: fetchPatterns,
  });

  const addMutation = useMutation({
    mutationFn: async (pattern: string) => {
      const res = await fetch("/api/excluded-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add pattern");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["excluded-patterns"] });
      toast.success("Pattern added");
      setNewPattern("");
      setAddOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/excluded-patterns/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["excluded-patterns"] });
      toast.success("Pattern removed");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPattern.trim()) return;
    addMutation.mutate(newPattern.trim());
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Excluded Patterns</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              Add Pattern
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Excluded Pattern</DialogTitle>
              <DialogDescription>
                Customer names or URLs matching this pattern will be excluded during API sync.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pattern-input">Pattern</Label>
                <Input
                  id="pattern-input"
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  placeholder="e.g. Blossman or https://..."
                  className="font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Matches by substring against customer names and URLs.
                </p>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addMutation.isPending}>
                  {addMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                  Add
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {!isLoading && (!patterns || patterns.length === 0) && (
        <Card>
          <CardContent className="flex items-center justify-center py-8 text-center">
            <p className="text-muted-foreground">
              No excluded patterns yet. Use the button above to add one.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && patterns && patterns.length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex flex-wrap gap-2">
              {patterns.map((p) => (
                <Badge
                  key={p.id}
                  variant="secondary"
                  className="gap-1 font-mono text-xs py-1 px-2"
                >
                  {p.pattern}
                  <button
                    onClick={() => deleteMutation.mutate(p.id)}
                    disabled={deleteMutation.isPending}
                    className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── User Types & Helpers ────────────────────────────────────────────────────

interface AppUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

async function fetchUsers(): Promise<AppUser[]> {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

// ─── User Form ──────────────────────────────────────────────────────────────

function UserForm({
  user,
  onSuccess,
  onCancel,
}: {
  user?: AppUser | null;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!user;

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password: string }) => {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User created");
      onSuccess();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string> }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated");
      onSuccess();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    if (!isEditing && !password) {
      toast.error("Password is required for new users");
      return;
    }
    if (password && password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    if (isEditing && user) {
      const data: Record<string, string> = { name: name.trim(), email: email.trim() };
      if (password) data.password = password;
      updateMutation.mutate({ id: user.id, data });
    } else {
      createMutation.mutate({ name: name.trim(), email: email.trim(), password });
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="user-name">Name</Label>
        <Input
          id="user-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="John Doe"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="user-email">Email</Label>
        <Input
          id="user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@company.com"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="user-password">
          {isEditing ? "New Password (leave blank to keep current)" : "Password"}
        </Label>
        <Input
          id="user-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isEditing ? "••••••" : "Min 6 characters"}
          required={!isEditing}
        />
      </div>
      <DialogFooter className="gap-2 sm:gap-0 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {isEditing ? "Save" : "Add User"}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── User Management Section ────────────────────────────────────────────────

function UserManagementSection() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete user");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted");
      setDeleteUser(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Users</h2>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="size-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
              <DialogDescription>
                Create a new user who can sign in to the dashboard.
              </DialogDescription>
            </DialogHeader>
            <UserForm
              user={null}
              onSuccess={() => setAddOpen(false)}
              onCancel={() => setAddOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {!isLoading && (!users || users.length === 0) && (
        <Card>
          <CardContent className="flex items-center justify-center py-8 text-center">
            <p className="text-muted-foreground">
              No users yet. The default admin will be created on first login.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && users && users.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
          {users.map((u) => (
            <Card key={u.id} className="border-l-4 border-l-muted hover:border-l-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground shrink-0" />
                    <CardTitle className="text-base truncate">{u.name}</CardTitle>
                  </div>
                  <CardDescription className="mt-1 text-xs font-mono">
                    {u.email}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex items-center gap-2 px-4 pb-3 pt-0">
                <Dialog
                  open={editUser?.id === u.id}
                  onOpenChange={(open) => { if (!open) setEditUser(null); }}
                >
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" onClick={() => setEditUser(u)}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Edit User</DialogTitle>
                      <DialogDescription>
                        Update user details or reset their password.
                      </DialogDescription>
                    </DialogHeader>
                    <UserForm
                      user={u}
                      onSuccess={() => setEditUser(null)}
                      onCancel={() => setEditUser(null)}
                    />
                  </DialogContent>
                </Dialog>
                <Dialog
                  open={deleteUser?.id === u.id}
                  onOpenChange={(open) => { if (!open) setDeleteUser(null); }}
                >
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteUser(u)}
                      disabled={(users?.length ?? 0) <= 1}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Delete User</DialogTitle>
                      <DialogDescription>
                        This will permanently remove &quot;{u.name}&quot; and they will no longer be able to sign in.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                      <Button variant="outline" onClick={() => setDeleteUser(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => deleteMutation.mutate(u.id)}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                        Delete
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Debug Log Section ───────────────────────────────────────────────────────

function DebugLogSection() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const enabled = settings?.debugLogEnabled !== "false";

  const toggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debugLogEnabled: String(value) }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      queryClient.invalidateQueries({ queryKey: ["debug-log"] });
      toast.success("Debug log setting updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/debug-log", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["debug-log"] });
      toast.success("Debug log cleared");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Debug Log</h2>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Logging</CardTitle>
          <CardDescription>
            When enabled, down/up events and webhook dispatches are logged and visible in the sidebar debug panel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="debug-log-toggle"
              checked={enabled}
              onCheckedChange={(v) => toggleMutation.mutate(v)}
              disabled={isLoading || toggleMutation.isPending}
            />
            <Label htmlFor="debug-log-toggle">
              {enabled ? "Debug logging enabled" : "Debug logging disabled"}
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            {clearMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            <Trash2 className="size-4" />
            Clear All Logs
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Zendesk Section ─────────────────────────────────────────────────────────

const DEFAULT_ZENDESK_SUBJECT = "{{monitorName}} is DOWN ({{downtimeMinutes}} min)";
const DEFAULT_ZENDESK_BODY = `Monitor: {{monitorName}}
URL: {{monitorUrl}}
Down since: {{timestamp}}
Duration: {{downtimeMinutes}} minutes

Error: {{message}}

This ticket was automatically created by the uptime monitor.`;

function ZendeskSection() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [subdomain, setSubdomain] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [groupId, setGroupId] = useState("");
  const [delayMinutes, setDelayMinutes] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [sslAlertsEnabled, setSslAlertsEnabled] = useState(false);

  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const initializedRef = useRef(false);

  // Initialize form fields from saved settings once they load, then auto-fetch groups.
  useEffect(() => {
    if (!settings || initializedRef.current) return;
    initializedRef.current = true;

    setEnabled(settings.zendeskEnabled === "true");
    setSubdomain(settings.zendeskSubdomain ?? "");
    setEmail(settings.zendeskEmail ?? "");
    setApiToken(settings.zendeskApiToken ?? "");
    setGroupId(settings.zendeskGroupId ?? "");
    setDelayMinutes(settings.zendeskTicketDelayMinutes ?? "30");
    setSubjectTemplate(settings.zendeskSubjectTemplate ?? DEFAULT_ZENDESK_SUBJECT);
    setBodyTemplate(settings.zendeskBodyTemplate ?? DEFAULT_ZENDESK_BODY);
    setSslAlertsEnabled(settings.zendeskSslAlertsEnabled === "true");

    const sd = settings.zendeskSubdomain ?? "";
    const em = settings.zendeskEmail ?? "";
    const at = settings.zendeskApiToken ?? "";
    const savedGroupId = settings.zendeskGroupId ?? "";
    if (sd && em && at) {
      fetch("/api/zendesk/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: sd, email: em, apiToken: at }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.groups?.length) {
            setGroups(data.groups);
          } else if (savedGroupId) {
            setGroups([{ id: parseInt(savedGroupId, 10), name: `Group ${savedGroupId}` }]);
          }
        })
        .catch(() => {
          if (savedGroupId) {
            setGroups([{ id: parseInt(savedGroupId, 10), name: `Group ${savedGroupId}` }]);
          }
        });
    }
  }, [settings]);

  const fetchGroups = async () => {
    if (!subdomain.trim() || !email.trim() || !apiToken.trim()) {
      toast.error("Enter subdomain, email, and API token first");
      return;
    }
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const res = await fetch("/api/zendesk/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain: subdomain.trim(),
          email: email.trim(),
          apiToken: apiToken.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch groups");
      setGroups(data.groups ?? []);
      if ((data.groups ?? []).length === 0) {
        toast.error("No groups found in this Zendesk account");
      } else {
        toast.success(`Loaded ${data.groups.length} group(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch groups";
      setGroupsError(msg);
      toast.error(msg);
    } finally {
      setGroupsLoading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Zendesk settings saved");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const testTicketMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/zendesk/test-ticket", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create test ticket");
      return data as { ticketId: string; ticketUrl: string };
    },
    onSuccess: (data) => {
      toast.success(
        <span>
          Test ticket <a href={data.ticketUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">#{data.ticketId}</a> created
        </span>
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const handleTestTicket = () => testTicketMutation.mutate();

  const hasZendeskCredentials = Boolean(
    subdomain.trim() && email.trim() && apiToken.trim() && groupId.trim()
  );

  const handleSave = () => {
    const delay = parseInt(delayMinutes, 10);
    if (isNaN(delay) || delay < 1) {
      toast.error("Ticket delay must be at least 1 minute");
      return;
    }
    if (enabled && (!subdomain.trim() || !email.trim() || !apiToken.trim() || !groupId.trim())) {
      toast.error("Subdomain, email, API token, and group ID are required when Zendesk is enabled");
      return;
    }
    saveMutation.mutate({
      zendeskEnabled: String(enabled),
      zendeskSubdomain: subdomain.trim(),
      zendeskEmail: email.trim(),
      zendeskApiToken: apiToken.trim(),
      zendeskGroupId: groupId.trim(),
      zendeskTicketDelayMinutes: String(delay),
      zendeskSslAlertsEnabled: String(sslAlertsEnabled),
      zendeskSubjectTemplate: subjectTemplate || DEFAULT_ZENDESK_SUBJECT,
      zendeskBodyTemplate: bodyTemplate || DEFAULT_ZENDESK_BODY,
    });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Zendesk Integration</h2>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-Create Zendesk Tickets</CardTitle>
          <CardDescription>
            Automatically open Zendesk tickets for prolonged outages, with an option to also create tickets for SSL certificate expirations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="zendesk-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={isLoading}
            />
            <Label htmlFor="zendesk-enabled">
              {enabled ? "Zendesk integration enabled" : "Zendesk integration disabled"}
            </Label>
          </div>

          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Switch
              id="zendesk-ssl-alerts-enabled"
              checked={sslAlertsEnabled}
              onCheckedChange={setSslAlertsEnabled}
              disabled={isLoading || !enabled || !hasZendeskCredentials}
            />
            <div className="space-y-1">
              <Label htmlFor="zendesk-ssl-alerts-enabled">
                Also create tickets for SSL expirations
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, opens a Zendesk ticket when a certificate is within the SSL alert threshold configured in SSL Certificate Alerts.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="zendesk-subdomain">Subdomain</Label>
              <Input
                id="zendesk-subdomain"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="yourcompany"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                The part before <span className="font-mono">.zendesk.com</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Group</Label>
              <div className="flex gap-2">
                <Select
                  value={groupId}
                  onValueChange={setGroupId}
                  disabled={isLoading || groups.length === 0}
                >
                  <SelectTrigger className="flex-1 font-mono">
                    <SelectValue
                      placeholder={
                        groups.length === 0
                          ? "Load groups first →"
                          : "Select a group"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={fetchGroups}
                  disabled={groupsLoading || isLoading}
                >
                  {groupsLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Load"
                  )}
                </Button>
              </div>
              {groupsError && (
                <p className="text-xs text-destructive">{groupsError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Click Load after entering your credentials to fetch available groups.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="zendesk-email">Agent Email</Label>
              <Input
                id="zendesk-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@company.com"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zendesk-api-token">API Token</Label>
              <Input
                id="zendesk-api-token"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Your Zendesk API token"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="zendesk-delay">Ticket Delay (minutes)</Label>
            <Input
              id="zendesk-delay"
              type="number"
              min={1}
              className="w-32 font-mono"
              value={delayMinutes}
              onChange={(e) => setDelayMinutes(e.target.value)}
              placeholder="30"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              A ticket is created only after a site has been continuously down for this many minutes.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="zendesk-subject">Ticket Subject Template</Label>
            <Input
              id="zendesk-subject"
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
              placeholder={DEFAULT_ZENDESK_SUBJECT}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="zendesk-body">Ticket Body Template</Label>
            <Textarea
              id="zendesk-body"
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
              placeholder={DEFAULT_ZENDESK_BODY}
              className="min-h-[160px] font-mono text-xs"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Available placeholders:{" "}
              <span className="font-mono">{"{{monitorName}}"}</span>,{" "}
              <span className="font-mono">{"{{monitorUrl}}"}</span>,{" "}
              <span className="font-mono">{"{{message}}"}</span>,{" "}
              <span className="font-mono">{"{{timestamp}}"}</span>,{" "}
              <span className="font-mono">{"{{downtimeMinutes}}"}</span>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleSave} disabled={saveMutation.isPending || isLoading}>
              {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Save Zendesk Settings
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestTicket}
              disabled={testTicketMutation.isPending || isLoading}
            >
              {testTicketMutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Make Test Ticket
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Settings Page ───────────────────────────────────────────────────────────

const SETTINGS_NAV = [
  { id: "users", label: "Users" },
  { id: "channels", label: "Channels" },
  { id: "timing", label: "Timing" },
  { id: "ssl", label: "SSL" },
  { id: "zendesk", label: "Zendesk" },
  { id: "retention", label: "Retention" },
  { id: "exclusions", label: "Exclusions" },
  { id: "debug", label: "Debug" },
];

export default function SettingsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const { data: channels, isLoading, error } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchChannels,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage notifications, check timing, integrations and data retention.
        </p>
      </div>

      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-2 border-b pb-4"
      >
        {SETTINGS_NAV.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="rounded-md border px-3 py-1.5 font-mono text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div id="users" className="scroll-mt-6 space-y-4">
        <UserManagementSection />
      </div>

      <div id="channels" className="scroll-mt-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">Notification Channels</h2>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" />
                Add Channel
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Channel</DialogTitle>
                <DialogDescription>
                  Create a new notification channel for alerts.
                </DialogDescription>
              </DialogHeader>
              <ChannelForm
                channel={null}
                onSuccess={() => setAddOpen(false)}
                onCancel={() => setAddOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {error && (
          <Card className="border-destructive/50">
            <CardContent className="py-6">
              <p className="text-destructive">
                {error instanceof Error ? error.message : "Failed to load channels"}
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && channels?.length === 0 && (
          <Card>
            <CardContent className="flex items-center justify-center py-12 text-center">
              <p className="text-muted-foreground">
                No notification channels yet. Use the button above to add one.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && channels && channels.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
            {channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        )}
      </div>

      <SettingsSection
        id="timing"
        title="Check Timing & Alerts"
        description="How often monitors run and when a failure becomes an alert."
      >
        <HeartbeatIntervalSection />
        <AlertDelaySection />
        <FalseDownProtectionSection />
      </SettingsSection>

      <SslAlertSection />

      <div id="zendesk" className="scroll-mt-6 space-y-4">
        <ZendeskSection />
      </div>

      <DataRetentionSection />

      <div id="exclusions" className="scroll-mt-6 space-y-4">
        <ExcludedPatternsSection />
      </div>

      <div id="debug" className="scroll-mt-6 space-y-4">
        <DebugLogSection />
      </div>
    </div>
  );
}
