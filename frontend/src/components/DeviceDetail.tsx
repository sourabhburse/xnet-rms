import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Code2,
  Ellipsis,
  ExternalLink,
  Globe2,
  History,
  Loader2,
  RefreshCw,
  Router,
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

import { Device, SessionItem, SnapshotField, SnapshotSource, User } from "../types";
import { api, formatApiError } from "../api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface DeviceDetailProps {
  device: Device;
  user: User;
  sessions: SessionItem[];
  onBack: () => void;
  onRefreshDevice: () => void;
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
}: {
  label: string;
  metric: { field: SnapshotField; source: SnapshotSource } | null;
  format?: (value: unknown, unit?: string) => string;
  meter?: number | null;
}) {
  const value = metric ? numberValue(metric.field.value) : null;
  const shown = metric ? format?.(metric.field.value, metric.field.unit) ?? `${displayValue(metric.field.value)}${metric.field.unit ? ` ${metric.field.unit}` : ""}` : "—";
  const meterWidth = meter == null ? null : Math.max(0, Math.min(100, meter));
  return (
    <div className="rounded-lg border border-border bg-secondary/35 p-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-[18px] font-semibold tabular-nums text-foreground">{shown}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${meterWidth ?? (value == null ? 0 : 36)}%`, opacity: meterWidth == null && value == null ? 0.35 : 1 }} />
      </div>
      <div className="mt-1 text-[10.5px] text-muted-foreground">{metric?.source.stale ? "Stale snapshot" : "Latest snapshot"}</div>
    </div>
  );
}

export default function DeviceDetail({
  device,
  user,
  sessions,
  onBack,
  onRefreshDevice,
}: DeviceDetailProps) {
  const [snapshots, setSnapshots] = useState<SnapshotSource[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedField, setSelectedField] = useState("");
  const [historyData, setHistoryData] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [closingSessionID, setClosingSessionID] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<{
    type: NoticeType;
    title: string;
    message: string;
    launchUrl?: string;
    sessionId?: string;
  } | null>(null);

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const canOperate = user.role !== "VIEWER";

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
      });
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
  const activeDeviceSessions = useMemo(
    () => sessions.filter((session) => session.device_id === device.id && !session.closed_at),
    [sessions, device.id],
  );
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

  const closeSession = async (sessionID = sessionNotice?.sessionId) => {
    if (!sessionID) return;
    setClosingSessionID(sessionID);
    try {
      await api(`sessions/${sessionID}`, "DELETE");
      if (sessionNotice?.sessionId === sessionID) setSessionNotice(null);
      toast.success("Session closed");
      void onRefreshDevice();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setClosingSessionID(null);
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

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4.5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-0.5 size-8 shrink-0" aria-label="Back to devices" onClick={onBack}><ArrowLeft className="size-4" /></Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <Router className="size-5 shrink-0 text-primary" />
              <h1 className="truncate font-display text-[20px] font-semibold text-foreground">{device.name || device.serial_number}</h1>
              <Badge variant={statusVariant(device.status)}><span className="size-1.5 rounded-full bg-current" />{statusLabel(device.status)}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[device.serial_number, device.model || "Unknown model", ...(device.groups ?? [])].map((chip, index) => <span key={`${chip}-${index}`} className={cn("rounded-md border px-2 py-1 text-[10.5px] text-muted-foreground", index === 0 ? "font-mono" : "bg-secondary/40")}>{chip}</span>)}
              {device.firmware_version && <span className="rounded-md border border-border bg-secondary/40 px-2 py-1 font-mono text-[10.5px] text-muted-foreground">v{device.firmware_version}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { void loadSnapshots(); onRefreshDevice(); }} disabled={loadingSnapshots}><RefreshCw className={cn("size-3.5", loadingSnapshots && "animate-spin")} />Refresh telemetry</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="size-8" aria-label="Device actions"><Ellipsis className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[190px]">
              <DropdownMenuItem disabled>Rename device</DropdownMenuItem>
              <DropdownMenuItem disabled>Move to group…</DropdownMenuItem>
              <DropdownMenuItem disabled>Edit tags…</DropdownMenuItem>
              {isSuperAdmin && !device.revoked && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setRevokeOpen(true)}>Revoke access…</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Card className="border-accent bg-accent/65">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="size-4.5" /></div>
            <div><CardTitle className="text-[14px]">Remote management</CardTitle><CardDescription className="mt-1 max-w-[680px] text-accent-foreground/80">Access the router through the reverse tunnel. Sessions roll back automatically after the 180 s watchdog window.</CardDescription></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleOpenRemote("SSH_LUCI")} disabled={!canOperate || device.status !== "ONLINE" || sessionLoading}><Globe2 className="size-4" />Open LuCI</Button>
            <Button variant="outline" onClick={() => handleOpenRemote("TERMINAL_SSH")} disabled={!canOperate || device.status !== "ONLINE" || sessionLoading}><Code2 className="size-4" />Open terminal</Button>
          </div>
        </CardContent>
      </Card>

      {sessionNotice && <Notice type={sessionNotice.type} title={sessionNotice.title} onClose={() => setSessionNotice(null)}>
        <p>{sessionNotice.message}</p>
        {sessionNotice.launchUrl && <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="border-current/25 bg-card/50" onClick={() => window.open(sessionNotice.launchUrl, "_blank")}><ExternalLink className="size-3.5" />Open session tab</Button>
          {sessionNotice.sessionId && <Button size="sm" variant="outline" className="border-current/25 bg-card/50" onClick={() => closeSession()}><XCircle className="size-3.5" />Close session</Button>}
        </div>}
      </Notice>}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry <span className="font-mono text-[10.5px] opacity-70">{snapshots.length}</span></TabsTrigger>
          <TabsTrigger value="history"><History className="size-3.5" />History</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.45fr]">
            <Card>
              <CardHeader className="border-b border-border"><CardTitle>Device identity</CardTitle><CardDescription>Registration and connectivity details</CardDescription></CardHeader>
              <CardContent className="p-4"><dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {[
                  ["Serial number", device.serial_number, true],
                  ["Device name", device.name || "—", false],
                  ["LAN MAC", device.lan_mac || "—", true],
                  ["Model", device.model || "Niseva router", false],
                  ["Firmware", device.firmware_version ? `v${device.firmware_version}` : "—", true],
                  ["Last communication", device.last_seen ? new Date(device.last_seen).toLocaleString() : "Never", true],
                ].map(([label, value, mono]) => <div key={String(label)}><dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className={cn("mt-1 text-[12.5px] text-foreground/90", mono && "font-mono text-[11px]")}>{value}</dd></div>)}
                <div className="sm:col-span-2"><dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Customer tags</dt><dd className="mt-1.5 flex flex-wrap gap-1.5">{device.tags?.length ? device.tags.map((tag) => <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>) : <span className="text-[12px] text-muted-foreground">No tags assigned</span>}</dd></div>
                <div className="sm:col-span-2"><dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Internal ID</dt><dd className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground" title={device.id}>{device.id}</dd></div>
              </dl></CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b border-border"><CardTitle>Live telemetry</CardTitle><CardDescription>Values from the most recent snapshot, when available</CardDescription></CardHeader>
              <CardContent className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MetricCard label="RSRP" metric={metrics.rsrp} format={(value, unit) => `${displayValue(value)} ${unit || "dBm"}`} meter={metrics.rsrp ? ((numberValue(metrics.rsrp.field.value) ?? -120) + 120) * (100 / 70) : null} />
                  <MetricCard label="SINR" metric={metrics.sinr} format={(value, unit) => `${displayValue(value)} ${unit || "dB"}`} meter={metrics.sinr ? ((numberValue(metrics.sinr.field.value) ?? 0) + 10) * 4 : null} />
                  <MetricCard label="CPU" metric={metrics.cpu} format={(value, unit) => `${displayValue(value)}${unit ? ` ${unit}` : "%"}`} meter={metrics.cpu ? numberValue(metrics.cpu.field.value) : null} />
                  <MetricCard label="Memory" metric={metrics.memory || metrics.memoryPercent} format={(value) => metrics.memory ? formatBytes(value) : `${displayValue(value)} %`} meter={metrics.memoryPercent ? numberValue(metrics.memoryPercent.field.value) : null} />
                  <MetricCard label="Throughput" metric={metrics.throughput} meter={metrics.throughput ? 48 : null} />
                  <MetricCard label="Temperature" metric={metrics.temperature} format={(value, unit) => `${displayValue(value)} ${unit || "°C"}`} meter={metrics.temperature ? (numberValue(metrics.temperature.field.value) ?? 0) : null} />
                </div>
                <div className="border-t border-border pt-3">
                  <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Available on this device</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <MetricCard label="RSSI" metric={metrics.rssi} format={(value, unit) => `${displayValue(value)} ${unit || "dBm"}`} />
                    <MetricCard label="Uptime" metric={metrics.uptime} format={(value) => formatDuration(value)} />
                    <MetricCard label="Data RX" metric={metrics.rx} format={(value) => formatBytes(value)} />
                    <MetricCard label="Data TX" metric={metrics.tx} format={(value) => formatBytes(value)} />
                    <MetricCard label="Registration" metric={metrics.registration} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="telemetry" className="mt-4">
          {snapshots.length === 0 ? <Card><CardContent className="flex min-h-36 flex-col items-center justify-center gap-1 p-6 text-center"><Loader2 className={cn("mb-1 size-5 text-muted-foreground", loadingSnapshots && "animate-spin")} /><p className="text-[13px] font-medium">No telemetry snapshots collected yet</p><p className="text-xs text-muted-foreground">Assign a monitoring profile to this device to collect periodic telemetry.</p></CardContent></Card> : <div className="flex flex-col gap-4">{snapshots.map((snapshot) => <Card key={snapshot.source_id}>
            <CardHeader className="flex-row items-start justify-between border-b border-border"><div><CardTitle>{snapshot.definition?.name || snapshot.source_id}</CardTitle><CardDescription className="mt-1">Observed {new Date(snapshot.observed_at).toLocaleString()}</CardDescription></div><Badge variant={snapshot.status === "ok" ? "ok" : "down"}>{snapshot.status} · {snapshot.stale ? "stale" : "fresh"}</Badge></CardHeader>
            <CardContent className="p-0">{snapshot.error && <div className="m-4 rounded-md border border-down-border bg-down-bg px-3 py-2 text-[12px] text-down">{snapshot.error}</div>}<div className="max-h-[520px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Current value</TableHead><TableHead>Type</TableHead></TableRow></TableHeader><TableBody>{Object.entries(snapshot.fields || {}).map(([id, field]) => <TableRow key={id}><TableCell className="font-medium">{field.label || id}</TableCell><TableCell className="font-mono text-[11px]">{displayValue(field.value)} {field.unit || ""}</TableCell><TableCell><Badge variant="secondary" className="font-normal capitalize">{field.kind || "text"}</Badge></TableCell></TableRow>)}</TableBody></Table></div></CardContent>
          </Card>)}</div>}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="border-b border-border"><CardTitle>Historical telemetry</CardTitle><CardDescription>Plot a numeric field from the selected monitoring source.</CardDescription></CardHeader>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-2">
                <select aria-label="Select telemetry source" value={selectedSource} onChange={(event) => { setSelectedSource(event.target.value); setSelectedField(""); }} className="h-9 min-w-[220px] rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"><option value="">Select telemetry source</option>{snapshots.map((snapshot) => <option key={snapshot.source_id} value={snapshot.source_id}>{snapshot.definition?.name || snapshot.source_id}</option>)}</select>
                <select aria-label="Select metric field" value={selectedField} onChange={(event) => setSelectedField(event.target.value)} disabled={!selectedSource || numericFieldOptions.length === 0} className="h-9 min-w-[220px] rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"><option value="">Select metric to plot</option>{numericFieldOptions.map(([id, field]) => <option key={id} value={id}>{field.label || id}</option>)}</select>
              </div>
              {selectedField ? <div className="mt-5 h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="time" stroke="var(--muted-foreground)" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis stroke="var(--muted-foreground)" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--popover)", color: "var(--popover-foreground)", fontSize: 12 }} /><Area type="monotone" dataKey="value" stroke="none" fill="var(--accent)" fillOpacity={0.75} /><Line type="monotone" dataKey="value" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2, fill: "var(--chart-2)" }} activeDot={{ r: 4, fill: "var(--chart-2)" }} connectNulls={false} /></LineChart></ResponsiveContainer></div> : <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-10 text-center text-[12px] text-muted-foreground">Select a numeric metric above to view its historical time series.</div>}
              <div className="mt-6 flex items-center gap-2 text-[12px] font-semibold text-foreground"><History className="size-4 text-primary" />Snapshot history log</div>
              <div className="mt-2 max-h-[520px] overflow-auto rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>Observed time</TableHead><TableHead>Status</TableHead><TableHead>Values snapshot</TableHead></TableRow></TableHeader><TableBody>{loadingHistory ? <TableRow><TableCell colSpan={3} className="h-20 text-center text-xs text-muted-foreground">Loading history…</TableCell></TableRow> : historyData.slice(0, 50).map((history, index) => <TableRow key={`${history.observed_at}-${index}`}><TableCell className="whitespace-nowrap font-mono text-[10.5px]">{new Date(history.observed_at).toLocaleString()}</TableCell><TableCell><Badge variant={history.status === "ok" ? "ok" : "down"}>{history.status}</Badge></TableCell><TableCell className="max-w-[520px] truncate font-mono text-[10.5px] text-muted-foreground" title={JSON.stringify(history.fields)}>{JSON.stringify(history.fields)}</TableCell></TableRow>)}</TableBody></Table></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card><CardHeader className="border-b border-border"><CardTitle>Remote sessions</CardTitle><CardDescription>Active sessions currently connected to this device.</CardDescription></CardHeader><CardContent className="p-4">{activeDeviceSessions.length ? <div className="space-y-2">{activeDeviceSessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ok-border bg-ok-bg p-3"><div className="flex min-w-0 items-center gap-2 text-[12px] text-ok"><CheckCircle2 className="size-4 shrink-0" /><div className="min-w-0"><div className="font-semibold">{session.protocol === "SSH_LUCI" ? "LuCI" : session.protocol === "TERMINAL_SSH" ? "Terminal SSH" : session.protocol} session active</div><div className="truncate font-mono text-[10.5px] opacity-80" title={session.id}>{session.id}</div><div className="text-[10.5px] opacity-80">Expires {session.expires_at ? new Date(session.expires_at).toLocaleString() : "—"}</div></div></div><Button variant="outline" size="sm" disabled={closingSessionID === session.id} onClick={() => closeSession(session.id)}><XCircle className="size-3.5" />{closingSessionID === session.id ? "Closing…" : "Close session"}</Button></div>)}</div> : sessionNotice?.sessionId ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ok-border bg-ok-bg p-3"><div className="flex items-center gap-2 text-[12px] text-ok"><CheckCircle2 className="size-4" /><span>Session {sessionNotice.sessionId.slice(0, 12)}… is active.</span></div><Button variant="outline" size="sm" disabled={closingSessionID === sessionNotice.sessionId} onClick={() => closeSession()}><XCircle className="size-3.5" />Close session</Button></div> : <div className="flex flex-col items-center justify-center gap-2 py-8 text-center"><Code2 className="size-6 text-muted-foreground/60" /><p className="text-[13px] font-medium">No active session</p><p className="max-w-[420px] text-xs text-muted-foreground">Start LuCI or a terminal session from the remote management card above.</p></div>}</CardContent></Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog open={revokeOpen} onOpenChange={setRevokeOpen} title="Revoke this router’s access?" description="The router certificate will be revoked immediately and this device will not be able to reconnect." confirmLabel="Revoke access" onConfirm={revokeDevice} />
    </div>
  );
}
