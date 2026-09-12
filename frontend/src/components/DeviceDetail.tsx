import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Code2,
  Ellipsis,
  ExternalLink,
  Globe2,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Device, SessionItem, SnapshotField, SnapshotSource, TagItem, User } from "../types";
import { api, formatApiError } from "../api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface DeviceDetailProps {
  device: Device;
  user: User;
  onBack: () => void;
  onRefreshDevice: () => void;
  sessions?: SessionItem[];
  onRefreshSessions?: () => void | Promise<void>;
  tags?: TagItem[];
}

type NoticeType = "success" | "warning" | "info" | "error";
type HistoryRow = {
  observed_at: string;
  status: string;
  fields?: Record<string, SnapshotField>;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return seconds <= 0 ? "Just now" : "In under a minute";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ${seconds < 0 ? "ago" : "from now"}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ${seconds < 0 ? "ago" : "from now"}`;
  return `${Math.abs(Math.round(hours / 24))}d ${seconds < 0 ? "ago" : "from now"}`;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(number) ? number : null;
}

function formatBytes(value: unknown) {
  const number = numberValue(value);
  if (number == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = Math.max(0, number);
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit++; }
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)} ${units[unit]}`;
}

function formatDuration(value: unknown) {
  const seconds = numberValue(value);
  if (seconds == null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function fieldMatches(key: string, field: SnapshotField, terms: string[]) {
  const haystack = `${key} ${field.label ?? ""} ${field.unit ?? ""}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function findMetric(sources: SnapshotSource[], terms: string[]) {
  for (const source of sources) {
    for (const [key, field] of Object.entries(source.fields ?? {})) {
      if (fieldMatches(key, field, terms)) return { field, source };
    }
  }
  return null;
}

function statusVariant(status: Device["status"]): "ok" | "down" | "neutral" {
  return status === "ONLINE" ? "ok" : status === "OFFLINE" ? "down" : "neutral";
}

function statusLabel(status: Device["status"]) {
  return status === "ONLINE" ? "Online" : status === "OFFLINE" ? "Offline" : "Revoked";
}

function networkAddress(device: Device) {
  const candidate = device as Device & { ip?: string; ip_address?: string; wan_ip?: string };
  return candidate.ip || candidate.ip_address || candidate.wan_ip || "No IP reported";
}

function Notice({
  type,
  title,
  children,
  onClose,
}: {
  type: NoticeType;
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const styles: Record<NoticeType, string> = {
    success: "border-ok-border bg-ok-bg text-ok",
    warning: "border-warn-border bg-warn-bg text-warn",
    info: "border-accent bg-accent text-accent-foreground",
    error: "border-down-border bg-down-bg text-down",
  };
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3", styles[type])}>
      {type === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-1 text-[12px] leading-5 opacity-90">{children}</div>
      </div>
      {onClose && <button type="button" className="text-xs font-medium underline underline-offset-2" onClick={onClose}>Dismiss</button>}
    </div>
  );
}

function MetricCard({
  label,
  metric,
  format,
  meter,
  trend,
}: {
  label: string;
  metric: { field: SnapshotField; source: SnapshotSource } | null;
  format?: (value: unknown, unit?: string) => string;
  meter?: number | null;
  trend?: number[];
}) {
  const shown = metric ? format?.(metric.field.value, metric.field.unit) ?? `${displayValue(metric.field.value)}${metric.field.unit ? ` ${metric.field.unit}` : ""}` : "—";
  const meterWidth = meter == null ? null : Math.max(0, Math.min(100, meter));
  const trendValues = trend?.filter((value) => Number.isFinite(value)).slice(-7) ?? [];
  const trendMin = trendValues.length ? Math.min(...trendValues) : 0;
  const trendMax = trendValues.length ? Math.max(...trendValues) : 0;
  const trendHeights = trendValues.map((value) => trendMax === trendMin ? 60 : Math.max(20, Math.min(100, Math.round(20 + ((value - trendMin) / (trendMax - trendMin)) * 80))));
  const heightClass = (height: number) => height < 35 ? "h-1/4" : height < 50 ? "h-2/5" : height < 65 ? "h-3/5" : height < 80 ? "h-4/5" : "h-full";
  return (
    <div className="min-w-0 border-b border-r border-row-divider px-6 py-4">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5 font-display text-[24px] font-semibold leading-none tabular-nums", !metric && "text-muted-foreground")}>{shown}</div>
      {meterWidth != null ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"><span className={cn("block h-full rounded-full bg-primary", meterWidth === 0 ? "w-0" : meterWidth < 12 ? "w-[10%]" : meterWidth < 25 ? "w-1/5" : meterWidth < 38 ? "w-[30%]" : meterWidth < 50 ? "w-2/5" : meterWidth < 63 ? "w-3/5" : meterWidth < 75 ? "w-3/4" : meterWidth < 88 ? "w-4/5" : "w-full")} /></div> : trendValues.length ? <div className="mt-2 flex h-[22px] items-end gap-0.5">{trendHeights.map((height, index) => <span key={`${height}-${index}`} className={cn("flex-1 bg-chart-4", index === trendHeights.length - 1 && "bg-primary", heightClass(height))} />)}</div> : <div className="mt-2 text-[13px] text-muted-foreground">{metric ? "Trend not collected" : "Not collected by this template"}</div>}
      {metric && <div className="mt-2 text-[11px] text-muted-foreground">{metric.source.stale ? "Stale snapshot" : "Latest snapshot"}</div>}
    </div>
  );
}

export default function DeviceDetail({
  device,
  user,
  onBack,
  onRefreshDevice,
  sessions = [],
  onRefreshSessions,
  tags = [],
}: DeviceDetailProps) {
  const [snapshots, setSnapshots] = useState<SnapshotSource[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedField, setSelectedField] = useState("");
  const [historyData, setHistoryData] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<{
    type: NoticeType;
    title: string;
    message: string;
    launchUrl?: string;
    sessionId?: string;
    expiresAt?: string;
  } | null>(null);

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const canOperate = user.role !== "VIEWER";
  const canAdmin = user.role === "ORG_ADMIN" || user.role === "SUPER_ADMIN";
  const activeSessions = sessions.filter((session) => session.device_id === device.id && !session.closed_at);
  const localSessionActive = Boolean(
    sessionNotice?.sessionId &&
    (!sessionNotice.expiresAt || Date.parse(sessionNotice.expiresAt) > Date.now()) &&
    !activeSessions.some((session) => session.id === sessionNotice.sessionId)
  );
  const sessionCount = activeSessions.length + (
    localSessionActive ? 1 : 0
  );

  const loadSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      const data = await api<SnapshotSource[]>(`devices/${device.id}/snapshots`);
      setSnapshots(data || []);
      if (!selectedSource && data && data.length > 0) setSelectedSource(data[0].source_id);
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setLoadingSnapshots(false);
    }
  };

  const loadHistory = async (sourceId: string) => {
    if (!sourceId) return;
    setLoadingHistory(true);
    try {
      const data = await api<HistoryRow[]>(`devices/${device.id}/history?source=${encodeURIComponent(sourceId)}`);
      setHistoryData(data || []);
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadSnapshots();
    const timer = setInterval(loadSnapshots, 30000);
    return () => clearInterval(timer);
  }, [device.id]);

  useEffect(() => {
    if (selectedSource) loadHistory(selectedSource);
  }, [selectedSource, device.id]);

  const handleOpenRemote = async (protocol: "SSH_LUCI" | "TERMINAL_SSH") => {
    setSessionLoading(true);
    setSessionNotice(null);
    try {
      const res = await api<{ id: string; expires_at: string; launch_url: string }>("sessions", "POST", { device_id: device.id, protocol });
      window.open(res.launch_url, "_blank");
      setSessionNotice({
        type: "success",
        title: protocol === "SSH_LUCI" ? "LuCI session launched" : "Terminal session launched",
        message: protocol === "SSH_LUCI" ? "LuCI is opening in a new tab. Sign in with the router administrator credentials when prompted." : "The web terminal is opening in a new tab.",
        launchUrl: res.launch_url,
        sessionId: res.id,
        expiresAt: res.expires_at,
      });
      void onRefreshSessions?.();
    } catch (err) {
      const formatted = formatApiError(err);
      setSessionNotice({ type: formatted.type as NoticeType, title: formatted.title, message: formatted.message });
    } finally {
      setSessionLoading(false);
    }
  };

  const currentSource = snapshots.find((snapshot) => snapshot.source_id === selectedSource);
  const currentFields = currentSource?.fields || {};
  const numericFieldOptions = Object.entries(currentFields).filter(([, field]) => field.kind === "gauge" || field.kind === "counter");
  const chartData = [...historyData].reverse().map((history) => ({
    time: new Date(history.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: selectedField ? numberValue(history.fields?.[selectedField]?.value) : null,
  }));

  const latestSources = snapshots.length ? snapshots : device.sources ?? [];
  const metrics = useMemo(() => ({
    rsrp: findMetric(latestSources, ["rsrp"]),
    sinr: findMetric(latestSources, ["sinr"]),
    cpu: findMetric(latestSources, ["cpu", "processor"]),
    memory: findMetric(latestSources, ["memory_used_bytes"]),
    memoryPercent: findMetric(latestSources, ["memory_used_percent"]),
    throughput: findMetric(latestSources, ["throughput", "bandwidth", "bitrate"]),
    temperature: findMetric(latestSources, ["temperature", "temp"]),
    rssi: findMetric(latestSources, ["rssi"]),
    uptime: findMetric(latestSources, ["uptime"]),
    rx: findMetric(latestSources, ["rx_bytes", "received"]),
    tx: findMetric(latestSources, ["tx_bytes", "sent"]),
    registration: findMetric(latestSources, ["registration"]),
  }), [latestSources]);

  const historyTrend = (terms: string[]) => historyData
    .map((history) => Object.entries(history.fields ?? {}).find(([key, field]) => fieldMatches(key, field, terms)))
    .map((entry) => entry ? numberValue(entry[1].value) : null)
    .filter((value): value is number => value != null);

  const displayedSession = activeSessions[0];
  const displayedSessionId = displayedSession?.id ?? (localSessionActive ? sessionNotice?.sessionId : undefined);
  const displayedExpiresAt = displayedSession?.expires_at ?? (localSessionActive ? sessionNotice?.expiresAt : undefined);
  const displayedProtocol = displayedSession?.protocol ?? "SSH_LUCI";

  const closeSession = async (sessionId = sessionNotice?.sessionId) => {
    if (!sessionId) return;
    try {
      await api(`sessions/${sessionId}`, "DELETE");
      if (sessionNotice?.sessionId === sessionId) setSessionNotice(null);
      void onRefreshSessions?.();
      toast.success("Session closed");
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  const extendSession = async (sessionId: string) => {
    setSessionActionId(sessionId);
    try {
      const result = await api<{ id: string; expires_at: string }>(`sessions/${sessionId}/extend`, "POST");
      setSessionNotice((notice) => notice?.sessionId === sessionId ? { ...notice, expiresAt: result.expires_at } : notice);
      void onRefreshSessions?.();
      toast.success("Session extended by 15 minutes");
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setSessionActionId(null);
    }
  };

  const revokeDevice = async () => {
    try {
      await api(`devices/${device.id}/revoke`, "POST", {});
      toast.success("Device revoked successfully");
      onBack();
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  const toggleTag = async (tag: TagItem) => {
    const assigned = device.tags?.includes(tag.name);
    try {
      await api(`devices/${device.id}/tags/${tag.id}`, assigned ? "DELETE" : "PUT");
      toast.success(assigned ? "Tag removed" : "Tag assigned");
      onRefreshDevice();
    } catch (err) { toast.error(formatApiError(err).message); }
  };

  return (
    <div className="flex min-h-full flex-col bg-card">
      <section className={cn("flex flex-wrap items-start justify-between gap-6 border-b border-border border-l-[3px] px-6 py-5", device.status === "ONLINE" ? "border-l-ok" : device.status === "OFFLINE" ? "border-l-down" : "border-l-neutral2")}>
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="outline" size="icon" className="mt-0.5 size-8 shrink-0" aria-label="Back to devices" onClick={onBack}><ArrowLeft className="size-4" /></Button>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">{device.name || device.serial_number}</h1>
            <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground">{device.serial_number} · {device.model || "Unknown model"}{device.firmware_version ? ` v${device.firmware_version}` : ""} · {(device.groups ?? ["No group"])[0]} · {networkAddress(device)}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]"><span className={cn("inline-flex items-center gap-1.5 font-medium", device.status === "ONLINE" ? "text-ok" : device.status === "OFFLINE" ? "text-down" : "text-neutral2")}><span className="size-1.5 rounded-full bg-current" />{statusLabel(device.status)}</span><span className="text-muted-foreground">Last contact <span className="font-mono text-foreground/75">{device.last_seen ? relativeTime(device.last_seen) : "Never"}</span></span><span className="text-muted-foreground">{device.active_alerts ? `${device.active_alerts} open alert${device.active_alerts === 1 ? "" : "s"}` : "No open alerts"}</span></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => void handleOpenRemote("SSH_LUCI")} disabled={!canOperate || device.status !== "ONLINE" || sessionLoading}><Globe2 />Open LuCI</Button><Button variant="outline" size="sm" onClick={() => void handleOpenRemote("TERMINAL_SSH")} disabled={!canOperate || device.status !== "ONLINE" || sessionLoading}><Code2 />Open terminal</Button><Button variant="outline" size="sm" onClick={() => { void loadSnapshots(); onRefreshDevice(); }} disabled={loadingSnapshots}><RefreshCw className={cn(loadingSnapshots && "animate-spin")} />Refresh</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="size-8" aria-label="Device actions"><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-[180px]"><DropdownMenuItem disabled={!canAdmin} onSelect={() => setTagEditorOpen(true)}>Edit tags…</DropdownMenuItem>{isSuperAdmin && !device.revoked && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setRevokeOpen(true)}>Revoke access…</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></div>
      </section>

      {(displayedSessionId || sessionNotice?.sessionId) && (displayedExpiresAt || sessionNotice?.sessionId) && <div className="flex flex-wrap items-center gap-3 border-b border-ok-border bg-session-ok-bg px-6 py-2.5 text-[13px] text-ok"><span className="size-1.5 rounded-full bg-ok" /><span>{displayedProtocol === "TERMINAL_SSH" ? "Terminal" : "LuCI"} session active{displayedSessionId ? ` · ${displayedSessionId.slice(0, 10)}…` : ""}{displayedExpiresAt ? <> · expires <span className="font-mono">{new Date(displayedExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></> : null}</span><div className="ml-auto flex flex-wrap gap-2">{sessionNotice?.launchUrl && <Button variant="outline" size="sm" className="h-7 border-ok-border bg-card" onClick={() => window.open(sessionNotice.launchUrl, "_blank")}><ExternalLink className="size-3.5" />Reopen tab</Button>}{displayedSessionId && <Button variant="outline" size="sm" className="h-7 border-ok-border bg-card" onClick={() => void extendSession(displayedSessionId)} disabled={sessionActionId === displayedSessionId}>Extend 15 min</Button>}{displayedSessionId && <Button variant="outline" size="sm" className="h-7 border-ok-border bg-card" onClick={() => void closeSession(displayedSessionId)}><XCircle className="size-3.5" />Close</Button>}</div></div>}

      {sessionNotice && (!sessionNotice.sessionId || localSessionActive) && <div className="px-6 pt-4"><Notice type={sessionNotice.type} title={sessionNotice.title} onClose={() => setSessionNotice(null)}><p>{sessionNotice.message}</p>{sessionNotice.type !== "success" && sessionNotice.launchUrl && <Button size="sm" variant="outline" className="mt-2 border-current/25 bg-card/50" onClick={() => window.open(sessionNotice.launchUrl, "_blank")}><ExternalLink className="size-3.5" />Open session tab</Button>}</Notice></div>}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full gap-5 bg-card px-6"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="telemetry">Telemetry <span className="font-mono text-[11px] opacity-70">{snapshots.length}</span></TabsTrigger><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="sessions">Sessions <span className="font-mono text-[11px] opacity-70">{sessionCount}</span></TabsTrigger><TabsTrigger value="audit">Audit</TabsTrigger></TabsList>

        <TabsContent value="overview" className="mt-0">
          <div className="grid lg:grid-cols-[1fr_1.75fr]">
            <section className="border-b border-border lg:border-b-0 lg:border-r"><div className="px-6 pb-2 pt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Identity</div><dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 px-6 pb-5 text-[13px]"><dt className="text-muted-foreground">Serial</dt><dd className="font-mono text-[12px]">{device.serial_number}</dd><dt className="text-muted-foreground">LAN MAC</dt><dd className="font-mono text-[12px]">{device.lan_mac || "—"}</dd><dt className="text-muted-foreground">WAN IP</dt><dd className="font-mono text-[12px]">{networkAddress(device)}</dd><dt className="text-muted-foreground">Model</dt><dd>{device.model || "Unknown model"}</dd><dt className="text-muted-foreground">Firmware</dt><dd className="font-mono text-[12px]">{device.firmware_version ? `v${device.firmware_version}` : "—"}</dd><dt className="text-muted-foreground">Group</dt><dd>{device.groups?.join(", ") || "No group"}</dd><dt className="text-muted-foreground">Tags</dt><dd className="flex flex-wrap gap-1.5">{device.tags?.length ? device.tags.map((tag) => <span key={tag} className="rounded border border-border bg-secondary/50 px-2 py-0.5 text-[12px]">{tag}</span>) : <span className="text-muted-foreground">No tags</span>}{canAdmin && <Button variant="link" size="sm" className="h-auto px-1 text-[12px]" onClick={() => setTagEditorOpen((open) => !open)}>Edit</Button>}</dd><dt className="text-muted-foreground">Enrolled</dt><dd className="font-mono text-[12px]">{device.last_seen ? new Date(device.last_seen).toLocaleDateString() : "—"}</dd></dl>{tagEditorOpen && <div className="mx-6 mb-5 flex flex-wrap gap-2 border-t border-border pt-3">{tags.filter((tag) => tag.organization_id === device.organization_id).map((tag) => <button type="button" key={tag.id} onClick={() => void toggleTag(tag)} className={cn("rounded border px-2 py-1 text-[11px]", device.tags?.includes(tag.name) ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")}>{device.tags?.includes(tag.name) ? "✓ " : "+ "}{tag.name}</button>)}</div>}<div className="border-t border-row-divider px-6 pb-5"><div className="pb-2 pt-[18px] font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Recent activity</div>{device.last_seen ? <div className="flex gap-3 py-1 text-[13px]"><span className="w-[58px] shrink-0 font-mono text-[12px] text-muted-foreground">{new Date(device.last_seen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span>Last contact received</span></div> : <p className="text-[13px] text-muted-foreground">No activity recorded.</p>}</div></section>
            <section><div className="flex items-center justify-between px-6 pb-2 pt-[18px]"><span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Telemetry · latest snapshot</span><span className="text-[13px] text-muted-foreground">{currentSource ? new Date(currentSource.observed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "No snapshot"}</span></div><div className="grid grid-cols-2 border-t border-border sm:grid-cols-3"><MetricCard label="RSRP" metric={metrics.rsrp} trend={historyTrend(["rsrp"])} format={(value, unit) => `${displayValue(value)} ${unit || "dBm"}`} /><MetricCard label="SINR" metric={metrics.sinr} trend={historyTrend(["sinr"])} format={(value, unit) => `${displayValue(value)} ${unit || "dB"}`} /><MetricCard label="CPU load" metric={metrics.cpu} meter={numberValue(metrics.cpu?.field.value)} format={(value, unit) => `${displayValue(value)}${unit ? ` ${unit}` : "%"}`} /><MetricCard label="Memory" metric={metrics.memory || metrics.memoryPercent} meter={numberValue(metrics.memoryPercent?.field.value)} format={(value) => metrics.memory ? formatBytes(value) : `${displayValue(value)} %`} /><MetricCard label="Temperature" metric={metrics.temperature} trend={historyTrend(["temperature", "temp"])} format={(value, unit) => `${displayValue(value)} ${unit || "°C"}`} /><MetricCard label="Throughput" metric={metrics.throughput} /></div><div className="grid grid-cols-2 gap-4 border-b border-row-divider px-6 py-4 text-[13px] sm:grid-cols-4"><span><span className="block text-muted-foreground">RSSI</span><span className="mt-1 block font-mono text-[12px]">{metrics.rssi ? `${displayValue(metrics.rssi.field.value)} ${metrics.rssi.field.unit || "dBm"}` : "—"}</span></span><span><span className="block text-muted-foreground">Uptime</span><span className="mt-1 block font-mono text-[12px]">{metrics.uptime ? formatDuration(metrics.uptime.field.value) : "—"}</span></span><span><span className="block text-muted-foreground">Data RX</span><span className="mt-1 block font-mono text-[12px]">{metrics.rx ? formatBytes(metrics.rx.field.value) : "—"}</span></span><span><span className="block text-muted-foreground">Registration</span><span className="mt-1 block">{metrics.registration ? displayValue(metrics.registration.field.value) : "—"}</span></span></div></section>
          </div>
        </TabsContent>

        <TabsContent value="telemetry" className="mt-0 px-6 py-4">{snapshots.length === 0 ? <section className="flex min-h-36 flex-col items-center justify-center gap-1 border border-border bg-card p-6 text-center"><Loader2 className={cn("mb-1 size-5 text-muted-foreground", loadingSnapshots && "animate-spin")} /><p className="text-[13px] font-medium">No telemetry snapshots collected yet</p><p className="text-[13px] text-muted-foreground">Assign a monitoring profile to this device to collect periodic telemetry.</p></section> : <div className="flex flex-col gap-4">{snapshots.map((snapshot) => <section key={snapshot.source_id} className="overflow-hidden border border-border bg-card"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5"><div><h2 className="font-display text-sm font-semibold">{snapshot.definition?.name || snapshot.source_id}</h2><p className="mt-1 text-xs text-muted-foreground">Observed {new Date(snapshot.observed_at).toLocaleString()}</p></div><Badge variant={snapshot.status === "ok" ? "ok" : "down"}>{snapshot.status} · {snapshot.stale ? "stale" : "fresh"}</Badge></div>{snapshot.error && <div className="m-4 rounded-md border border-down-border bg-down-bg px-3 py-2 text-[12px] text-down">{snapshot.error}</div>}<div className="max-h-[520px] overflow-auto"><table className="w-full text-[13px]"><thead className="border-b border-border bg-secondary/40 text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">Metric</th><th className="px-4 py-2.5">Current value</th><th className="px-4 py-2.5">Type</th></tr></thead><tbody>{Object.entries(snapshot.fields || {}).map(([id, field]) => <tr key={id} className="border-b border-row-divider"><td className="px-4 py-3 font-medium">{field.label || id}</td><td className="px-4 py-3 font-mono text-[12px]">{displayValue(field.value)} {field.unit || ""}</td><td className="px-4 py-3"><Badge variant="secondary" className="font-normal capitalize">{field.kind || "text"}</Badge></td></tr>)}</tbody></table></div></section>)}</div>}</TabsContent>

        <TabsContent value="history" className="mt-0 px-6 py-4"><section className="border border-border bg-card"><div className="border-b border-border px-4 py-3.5"><h2 className="font-display text-sm font-semibold">Historical telemetry</h2><p className="mt-1 text-xs text-muted-foreground">Plot a numeric field from the selected monitoring source.</p></div><div className="p-4"><div className="flex flex-wrap gap-2"><select aria-label="Select telemetry source" value={selectedSource} onChange={(event) => { setSelectedSource(event.target.value); setSelectedField(""); }} className="h-9 min-w-[220px] rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"><option value="">Select telemetry source</option>{snapshots.map((snapshot) => <option key={snapshot.source_id} value={snapshot.source_id}>{snapshot.definition?.name || snapshot.source_id}</option>)}</select><select aria-label="Select metric field" value={selectedField} onChange={(event) => setSelectedField(event.target.value)} disabled={!selectedSource || numericFieldOptions.length === 0} className="h-9 min-w-[220px] rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"><option value="">Select metric to plot</option>{numericFieldOptions.map(([id, field]) => <option key={id} value={id}>{field.label || id}</option>)}</select></div>{selectedField ? <div className="mt-5 h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" stroke="var(--muted-foreground)" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis stroke="var(--muted-foreground)" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover)", color: "var(--popover-foreground)", fontSize: 12 }} /><Area type="monotone" dataKey="value" stroke="none" fill="var(--accent)" fillOpacity={0.75} /><Line type="monotone" dataKey="value" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2, fill: "var(--chart-2)" }} activeDot={{ r: 4, fill: "var(--chart-2)" }} connectNulls={false} /></LineChart></ResponsiveContainer></div> : <div className="mt-5 rounded-md border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">Select a numeric metric above to view its historical time series.</div>}<div className="mt-6 flex items-center gap-2 text-[12px] font-semibold"><History className="size-4 text-primary" />Snapshot history log</div><div className="mt-2 overflow-hidden rounded-md border border-border"><table className="w-full text-[13px]"><thead className="border-b border-border bg-secondary/40 text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="w-8 px-3" /><th className="px-3 py-2.5">Observed time</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Fields</th></tr></thead><tbody>{loadingHistory ? <tr><td colSpan={4} className="h-20 px-3 text-center text-xs text-muted-foreground">Loading history…</td></tr> : historyData.slice(0, 50).map((history, index) => { const rowId = `${history.observed_at}-${index}`; const expanded = expandedHistory === rowId; return <React.Fragment key={rowId}><tr className="border-b border-row-divider hover:bg-secondary/30"><td className="px-3"><button type="button" aria-label={expanded ? "Collapse history row" : "Expand history row"} onClick={() => setExpandedHistory(expanded ? null : rowId)}><ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} /></button></td><td className="whitespace-nowrap px-3 py-3 font-mono text-[11px]">{new Date(history.observed_at).toLocaleString()}</td><td className="px-3 py-3"><Badge variant={history.status === "ok" ? "ok" : "down"}>{history.status}</Badge></td><td className="max-w-[520px] truncate px-3 py-3 text-muted-foreground">{Object.keys(history.fields ?? {}).length} metrics</td></tr>{expanded && <tr className="border-b border-row-divider bg-secondary/20"><td colSpan={4} className="px-6 py-3"><div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(history.fields ?? {}).map(([id, field]) => <div key={id} className="min-w-0"><span className="block truncate text-[11px] text-muted-foreground">{field.label || id}</span><span className="font-mono text-[12px]">{displayValue(field.value)} {field.unit || ""}</span></div>)}</div></td></tr>}</React.Fragment>; })}</tbody></table></div></div></section></TabsContent>

        <TabsContent value="sessions" className="mt-0 px-6 py-4"><section className="border border-border bg-card"><div className="border-b border-border px-4 py-3.5"><h2 className="font-display text-sm font-semibold">Remote sessions</h2><p className="mt-1 text-xs text-muted-foreground">Active sessions connected to this device.</p></div><div className="space-y-2 p-4">{activeSessions.length ? activeSessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-l-ok bg-session-ok-bg p-3"><div><div className="flex items-center gap-2 text-[13px] text-ok"><CheckCircle2 className="size-4" />{session.protocol === "TERMINAL_SSH" ? "Terminal" : "LuCI"} session is active</div><p className="mt-1 pl-6 font-mono text-[11px] text-ok/80">Expires {new Date(session.expires_at).toLocaleTimeString()}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void extendSession(session.id)} disabled={sessionActionId === session.id}>Extend 15 min</Button><Button variant="outline" size="sm" onClick={() => void closeSession(session.id)}><XCircle className="size-3.5" />Close session</Button></div></div>) : <div className="flex flex-col items-center justify-center gap-2 py-8 text-center"><Code2 className="size-6 text-muted-foreground/60" /><p className="text-[13px] font-medium">No active session</p><p className="text-[13px] text-muted-foreground">Start LuCI or a terminal session from the header.</p></div>}</div></section></TabsContent>

        <TabsContent value="audit" className="mt-0 px-6 py-4"><section className="border border-border bg-card p-6"><h2 className="font-display text-sm font-semibold">Audit trail</h2><p className="mt-1 text-[13px] text-muted-foreground">Audit events are available from the Audit records area. This device view does not currently receive an audit feed.</p></section></TabsContent>
      </Tabs>

      <ConfirmDialog open={revokeOpen} onOpenChange={setRevokeOpen} title="Revoke this router’s access?" description="The router certificate will be revoked immediately and this device will not be able to reconnect." confirmLabel="Revoke access" onConfirm={revokeDevice} />
    </div>
  );
}
