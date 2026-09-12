import React from "react";
import { ArrowRight, Cable, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Device, DeviceGroup, DashboardStats, SessionItem, User } from "../../types";

interface FleetOverviewProps {
  stats: DashboardStats;
  pendingCount: number;
  awaitingCount: number;
  sessions: SessionItem[];
  groups: DeviceGroup[];
  devices: Device[];
  user: User;
  onNavigate: (view: string) => void;
  onSelectFilter: (status: string) => void;
  onOpenLuCI: (device: Device) => void;
  onOpenTerminal: (device: Device) => void;
}

type Tone = "ok" | "down" | "warn" | "neutral";
type AttentionItem = {
  device: Device;
  issue: string;
  tone: Tone;
  since: string;
  rank: number;
};

const toneText: Record<Tone, string> = {
  ok: "text-ok",
  down: "text-down",
  warn: "text-warn",
  neutral: "text-neutral2",
};

const toneRail: Record<Tone, string> = {
  ok: "border-l-ok",
  down: "border-l-down",
  warn: "border-l-warn",
  neutral: "border-l-neutral2",
};

function parseNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractRsrp(device: Device) {
  for (const source of device.sources ?? []) {
    for (const [key, field] of Object.entries(source.fields ?? {})) {
      const haystack = `${key} ${field.label ?? ""} ${field.unit ?? ""}`.toLowerCase();
      if (haystack.includes("rsrp") || field.unit?.toLowerCase() === "dbm") {
        const value = parseNumber(field.value);
        if (value != null) return value;
      }
    }
  }
  return null;
}

function formatSince(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function latestTelemetryTime(device: Device) {
  const sourceTimes = (device.sources ?? [])
    .map((source) => source.observed_at)
    .filter(Boolean)
    .sort();
  const sourceTime = sourceTimes[sourceTimes.length - 1];
  return sourceTime || device.last_seen;
}

function attentionFor(device: Device): AttentionItem | null {
  if (device.status === "OFFLINE") {
    const alerts = device.active_alerts ? ` · ${device.active_alerts} alert${device.active_alerts === 1 ? "" : "s"}` : "";
    return { device, issue: `Offline${alerts}`, tone: "down", since: device.last_seen, rank: 4 };
  }
  if (device.health === "critical") {
    return { device, issue: "Critical health", tone: "down", since: latestTelemetryTime(device), rank: 3 };
  }
  const rsrp = extractRsrp(device);
  if (rsrp != null && rsrp < -100) {
    return { device, issue: `RSRP ${Math.round(rsrp)} dBm`, tone: "warn", since: latestTelemetryTime(device), rank: 2 };
  }
  if (device.health === "warning" || (rsrp != null && rsrp < -90)) {
    const issue = device.health === "warning" ? "Degraded health" : `RSRP ${Math.round(rsrp!)} dBm`;
    return { device, issue, tone: "warn", since: latestTelemetryTime(device), rank: 2 };
  }
  if ((device.sources ?? []).some((source) => source.stale)) {
    return { device, issue: "Telemetry stale", tone: "warn", since: latestTelemetryTime(device), rank: 1 };
  }
  return null;
}

function meterWidth(value: number, max: number) {
  if (max <= 0 || value <= 0) return "w-0";
  const step = Math.min(10, Math.max(1, Math.ceil((value / max) * 10)));
  return (["w-0", "w-[10%]", "w-[20%]", "w-[30%]", "w-[40%]", "w-1/2", "w-[60%]", "w-[70%]", "w-4/5", "w-[90%]", "w-full"] as const)[step];
}

function KpiTile({
  label,
  value,
  caption,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: number;
  caption: React.ReactNode;
  tone?: Tone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "border-b border-r border-border px-6 py-4 text-left transition-colors last:border-r-0 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        tone === "down" && "bg-kpi-down-bg hover:bg-kpi-down-bg/80"
      )}
      onClick={onClick}
    >
      <span className={cn("font-mono text-[11px] uppercase tracking-[0.08em]", tone === "neutral" ? "text-muted-foreground" : toneText[tone])}>{label}</span>
      <span className={cn("mt-2 block font-display text-[32px] font-semibold leading-none tabular-nums", tone === "down" ? "text-down" : "text-foreground")}>{value.toLocaleString()}</span>
      <span className="mt-2 block text-[13px] text-muted-foreground">{caption}</span>
    </button>
  );
}

export default function FleetOverview({
  stats,
  pendingCount,
  awaitingCount,
  sessions,
  groups,
  devices,
  user,
  onNavigate,
  onSelectFilter,
  onOpenLuCI,
  onOpenTerminal,
}: FleetOverviewProps) {
  const isOrgAdmin = user.role === "SUPER_ADMIN" || user.role === "ORG_ADMIN";
  const total = stats.total || devices.length;
  const online = stats.online;
  const offline = stats.offline;
  const onboarding = pendingCount + awaitingCount;
  const onlinePercent = total > 0 ? Math.round((online / total) * 100) : 0;

  const weakSignal = React.useMemo(
    () => devices.filter((device) => {
      const rsrp = extractRsrp(device);
      return rsrp != null && rsrp < -90;
    }).length,
    [devices]
  );

  const attention = React.useMemo(
    () => devices
      .map(attentionFor)
      .filter((item): item is AttentionItem => item != null)
      .sort((a, b) => b.rank - a.rank || Date.parse(a.since) - Date.parse(b.since))
      .slice(0, 5),
    [devices]
  );

  const activeSessions = React.useMemo(() => sessions.filter((session) => !session.closed_at), [sessions]);
  const groupRows = React.useMemo(() => groups.slice(0, 4).map((group) => {
    const members = devices.filter((device) => device.groups?.includes(group.name));
    const count = group.device_count || members.length;
    const onlineMembers = members.filter((device) => device.status === "ONLINE").length;
    const health = members.length ? Math.round((onlineMembers / members.length) * 100) : null;
    return { group, count, health };
  }), [devices, groups]);

  return (
    <div className="flex min-h-full flex-col bg-card">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 pb-[18px] pt-6">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">Fleet</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Workspace · updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        {isOrgAdmin && <div className="flex gap-2"><Button variant="outline" size="sm" aria-label="Select time range">Last 24 h</Button><Button size="sm" onClick={() => onNavigate("add-devices")}><Plus />Add devices</Button></div>}
      </section>

      <section className="grid grid-cols-2 border-b border-border bg-card md:grid-cols-5">
        <KpiTile label="Enrolled" value={total} caption="All registered routers" onClick={() => { onSelectFilter(""); onNavigate("devices"); }} />
        <KpiTile label="Online" value={online} tone="ok" caption={`${onlinePercent}% reporting`} onClick={() => { onSelectFilter("ONLINE"); onNavigate("devices"); }} />
        <KpiTile label="Offline" value={offline} tone="down" caption="Needs attention" onClick={() => { onSelectFilter("OFFLINE"); onNavigate("devices"); }} />
        <KpiTile label="Onboarding" value={onboarding} tone="warn" caption={`${awaitingCount} awaiting · ${pendingCount} unclaimed`} onClick={() => onNavigate("registration-requests")} />
        <KpiTile label="Weak signal" value={weakSignal} tone="warn" caption="< −90 dBm" onClick={() => { onSelectFilter("WEAK_SIGNAL"); onNavigate("devices"); }} />
      </section>

      <div className="grid min-w-0 flex-1 lg:grid-cols-[1.55fr_1fr]">
        <section className="min-w-0 border-b border-border lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 px-6 pb-3 pt-4"><div><h2 className="font-display text-[15px] font-semibold text-foreground">Needs attention</h2><p className="mt-0.5 text-[13px] text-muted-foreground">Ranked by severity and time affected</p></div><button type="button" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline" onClick={() => { onSelectFilter(""); onNavigate("devices"); }}>Open in devices <ArrowRight className="size-3.5" /></button></div>
          <div className="grid grid-cols-[2fr_1.5fr_.9fr_auto] gap-3 border-y border-border px-6 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"><span>Device</span><span>Issue</span><span>Since</span><span /></div>
          {attention.length ? attention.map((item) => <div key={item.device.id} className={cn("grid grid-cols-[2fr_1.5fr_.9fr_auto] items-center gap-3 border-b border-row-divider border-l-[3px] px-6 py-3.5", toneRail[item.tone], item.tone === "down" && "bg-row-down-bg")}><button type="button" className="min-w-0 text-left" onClick={() => onNavigate("devices")}><span className="block truncate text-[13px] font-semibold text-foreground">{item.device.name || item.device.serial_number}</span><span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{item.device.serial_number} · {(item.device.groups ?? ["No group"])[0]}</span></button><span className={cn("truncate text-[13px]", toneText[item.tone])}>{item.issue}</span><span className="whitespace-nowrap font-mono text-[13px] text-foreground/75">{formatSince(item.since)}</span><Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px]" onClick={() => onNavigate("devices")}>Inspect</Button></div>) : <div className="px-6 py-10 text-center text-[13px] text-muted-foreground">No devices need attention.</div>}
        </section>

        <section className="min-w-0 bg-card">
          <div className="flex items-center justify-between px-6 pb-3 pt-4"><h2 className="font-display text-[15px] font-semibold text-foreground">Live sessions</h2><span className="font-mono text-[11px] text-muted-foreground">{activeSessions.length} active</span></div>
          {activeSessions.slice(0, 4).map((session) => { const device = devices.find((item) => item.id === session.device_id); if (!device) return null; const isLuci = session.protocol === "SSH_LUCI" || session.protocol === "HTTP_LUCI"; return <div key={session.id} className="flex items-center gap-3 border-t border-row-divider px-6 py-3"><span className={cn("w-9 font-mono text-[11px]", isLuci ? "text-primary" : "text-neutral2")}>{isLuci ? "LuCI" : "SSH"}</span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-foreground">{device.name || device.serial_number}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">expires {new Date(session.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></span><Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px]" onClick={() => isLuci ? onOpenLuCI(device) : onOpenTerminal(device)}>Join</Button></div>; })}
          {!activeSessions.length && <div className="border-t border-row-divider px-6 py-8 text-center text-[13px] text-muted-foreground"><Cable className="mx-auto mb-2 size-5" />No active sessions.</div>}
          <h2 className="border-t border-border px-6 pb-3 pt-[18px] font-display text-[15px] font-semibold text-foreground">Onboarding</h2>
          <button type="button" className="flex w-full items-center gap-3 border-t border-row-divider px-6 py-3 text-left hover:bg-secondary/40" onClick={() => onNavigate("registration-requests")}><span className="w-9 font-display text-[20px] font-semibold tabular-nums text-foreground">{awaitingCount}</span><span><span className="block text-[13px] font-medium">Awaiting device</span><span className="block text-[13px] text-muted-foreground">pre-registered, not yet connected</span></span></button>
          <button type="button" className="flex w-full items-center gap-3 border-y border-row-divider px-6 py-3 text-left hover:bg-secondary/40" onClick={() => onNavigate("available-to-claim")}><span className="w-9 font-display text-[20px] font-semibold tabular-nums text-warn">{pendingCount}</span><span className="flex-1"><span className="block text-[13px] font-medium">Available to claim</span><span className="block text-[13px] text-muted-foreground">connected, ready for ownership</span></span><ArrowRight className="size-4 text-muted-foreground" /></button>
          <div className="px-6 pb-5"><div className="flex items-center justify-between pb-3 pt-[18px]"><h2 className="font-display text-[15px] font-semibold text-foreground">Groups</h2><button type="button" className="text-[13px] font-medium text-primary hover:underline" onClick={() => onNavigate("groups")}>Manage</button></div>{groupRows.length ? groupRows.map(({ group, count, health }) => <div key={group.id} className="flex items-center gap-3 border-t border-row-divider py-2.5"><span className="min-w-0 flex-1 truncate text-[13px]">{group.name}</span><span className="font-mono text-[12px] text-muted-foreground">{count.toLocaleString()}</span>{health != null ? <><span className="h-1.5 w-[54px] overflow-hidden rounded-full bg-secondary"><span className={cn("block h-full rounded-full bg-primary", meterWidth(health, 100))} /></span><span className="w-8 text-right font-mono text-[12px] text-foreground/75">{health}%</span></> : <span className="w-[94px] text-right font-mono text-[12px] text-muted-foreground">—</span>}</div>) : <p className="border-t border-row-divider pt-3 text-[13px] text-muted-foreground">No groups configured.</p>}</div>
        </section>
      </div>
    </div>
  );
}
