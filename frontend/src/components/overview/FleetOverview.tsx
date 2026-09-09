import React from "react";
import { Plus, Cable, Globe, TerminalSquare, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  DashboardStats,
  Device,
  DeviceGroup,
  SessionItem,
  User,
} from "../../types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

type StatusTone = "ok" | "down" | "warn" | "neutral";

const toneRing: Record<StatusTone, string> = {
  ok: "bg-ok",
  down: "bg-down",
  warn: "bg-warn",
  neutral: "bg-neutral2",
};

function KpiTile({
  label,
  value,
  caption,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  caption: string;
  tone: StatusTone;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1.5 overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-border/70 hover:bg-secondary/40"
    >
      <span className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", toneRing[tone])} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          {label}
        </span>
      </span>
      <span className="font-display text-[25px] font-bold leading-none tabular-nums text-foreground">
        {value.toLocaleString()}
      </span>
      <span className="text-[11.5px] text-muted-foreground">{caption}</span>
    </button>
  );
}

function RatioBar({
  online,
  offline,
  revoked,
}: {
  online: number;
  offline: number;
  revoked: number;
}) {
  const total = Math.max(online + offline + revoked, 1);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className="bg-ok" style={{ width: seg(online) }} />
      <div
        className="bg-down"
        style={{ width: seg(offline), marginLeft: online ? 2 : 0 }}
      />
      {revoked > 0 && (
        <div
          className="bg-neutral2"
          style={{ width: seg(revoked), marginLeft: 2 }}
        />
      )}
    </div>
  );
}

function ModelBar({
  name,
  count,
  max,
  online,
}: {
  name: string;
  count: number;
  max: number;
  online: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const onlinePct = count > 0 ? Math.round((online / count) * 100) : 0;
  return (
    <div className="grid grid-cols-[128px_1fr_auto] items-center gap-3">
      <span className="truncate text-[12.5px] text-foreground/80" title={name}>
        {name}
      </span>
      <span className="h-2.5 overflow-hidden rounded-full bg-secondary">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </span>
      <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
        <b className="font-medium text-foreground">{count}</b> &middot; {onlinePct}% online
      </span>
    </div>
  );
}

/** Best-effort RSRP extraction from telemetry snapshots. */
function extractRsrp(device: Device): number | null {
  for (const src of device.sources ?? []) {
    for (const [key, field] of Object.entries(src.fields ?? {})) {
      const hay = `${key} ${field.label ?? ""} ${field.unit ?? ""}`.toLowerCase();
      if (hay.includes("rsrp") || (field.unit ?? "").toLowerCase() === "dbm") {
        const num =
          typeof field.value === "number"
            ? field.value
            : parseFloat(String(field.value));
        if (!Number.isNaN(num)) return num;
      }
    }
  }
  return null;
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
  const isOrgAdmin =
    user.role === "SUPER_ADMIN" || user.role === "ORG_ADMIN";

  const total = stats.total || devices.length || 0;
  const online = stats.online || 0;
  const offline = stats.offline || 0;
  const revoked = stats.revoked || 0;
  const health = total > 0 ? Math.round((online / total) * 100) : 100;

  const activeSessions = React.useMemo(
    () => sessions.filter((s) => !s.closed_at),
    [sessions]
  );

  const modelStats = React.useMemo(() => {
    const map = new Map<string, { count: number; online: number }>();
    for (const d of devices) {
      const model = d.model || "Niseva router";
      const cur = map.get(model) || { count: 0, online: 0 };
      cur.count += 1;
      if (d.status === "ONLINE") cur.online += 1;
      map.set(model, cur);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [devices]);
  const modelMax = modelStats.reduce((m, x) => Math.max(m, x.count), 0);

  const signalBuckets = React.useMemo(() => {
    const buckets = [
      { key: "Excellent", note: "≥ −80 dBm", count: 0 },
      { key: "Good", note: "−80 to −90", count: 0 },
      { key: "Fair", note: "−90 to −100", count: 0 },
      { key: "Poor", note: "< −100 dBm", count: 0 },
    ];
    let measured = 0;
    for (const d of devices) {
      const rsrp = extractRsrp(d);
      if (rsrp == null) continue;
      measured += 1;
      if (rsrp >= -80) buckets[0].count += 1;
      else if (rsrp >= -90) buckets[1].count += 1;
      else if (rsrp >= -100) buckets[2].count += 1;
      else buckets[3].count += 1;
    }
    return { buckets, measured };
  }, [devices]);
  const bucketMax = signalBuckets.buckets.reduce(
    (m, b) => Math.max(m, b.count),
    0
  );
  const rampColors = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4"];

  return (
    <div className="flex flex-col gap-4.5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[21px] font-semibold text-foreground">
            Network overview
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {total.toLocaleString()} enrolled routers &middot; live telemetry,
            health, and remote access.
          </p>
        </div>
        {isOrgAdmin && (
          <Button onClick={() => onNavigate("add-devices")}>
            <Plus className="size-4" />
            Add devices
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Online now"
          value={online}
          caption="Reporting telemetry"
          tone="ok"
          onClick={() => {
            onSelectFilter("ONLINE");
            onNavigate("devices");
          }}
        />
        <KpiTile
          label="Offline"
          value={offline}
          caption="Needs attention"
          tone="down"
          onClick={() => {
            onSelectFilter("OFFLINE");
            onNavigate("devices");
          }}
        />
        <KpiTile
          label="Awaiting setup"
          value={awaitingCount}
          caption="Pre-registered"
          tone="warn"
          onClick={() => onNavigate("registration-requests")}
        />
        <KpiTile
          label="Revoked"
          value={revoked}
          caption="Access disabled"
          tone="neutral"
          onClick={() => {
            onSelectFilter("REVOKED");
            onNavigate("devices");
          }}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4.5 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4.5">
          <Card>
            <CardHeader className="flex-row items-start justify-between border-b border-border">
              <div>
                <CardTitle>Connectivity &amp; health</CardTitle>
                <CardDescription>
                  Live operational status across all hardware
                </CardDescription>
              </div>
              <Badge variant={health >= 90 ? "ok" : "warn"}>
                {health}% operational
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-[12px] font-medium text-foreground/80">
                  <span>Connection ratio</span>
                  <span className="font-mono text-foreground">
                    {online.toLocaleString()} online / {offline.toLocaleString()}{" "}
                    offline
                  </span>
                </div>
                <RatioBar online={online} offline={offline} revoked={revoked} />
              </div>

              <div className="flex flex-col gap-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Hardware breakdown
                </div>
                {modelStats.length > 0 ? (
                  modelStats.map((m) => (
                    <ModelBar
                      key={m.name}
                      name={m.name}
                      count={m.count}
                      max={modelMax}
                      online={m.online}
                    />
                  ))
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No devices in view.
                  </p>
                )}
              </div>
            </CardContent>
            <CardFooter>
              <span>Device inventory</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-primary"
                onClick={() => {
                  onSelectFilter("");
                  onNavigate("devices");
                }}
              >
                View all devices <ArrowRight className="size-3.5" />
              </button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>LTE signal quality</CardTitle>
              <CardDescription>
                RSRP distribution &middot;{" "}
                {signalBuckets.measured > 0
                  ? `${signalBuckets.measured} cellular devices reporting`
                  : "no cellular telemetry in view"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {signalBuckets.measured > 0 ? (
                <div className="flex flex-col gap-3">
                  {signalBuckets.buckets.map((b, i) => {
                    const pct =
                      bucketMax > 0
                        ? Math.round((b.count / bucketMax) * 100)
                        : 0;
                    return (
                      <div
                        key={b.key}
                        className="grid grid-cols-[92px_1fr_auto] items-center gap-3"
                      >
                        <span className="text-[12.5px] text-foreground/80">
                          {b.key}
                        </span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-secondary">
                          <span
                            className={cn(
                              "block h-full rounded-full",
                              rampColors[i]
                            )}
                            style={{ width: `${Math.max(pct, 3)}%` }}
                          />
                        </span>
                        <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
                          <b className="font-medium text-foreground">
                            {b.count}
                          </b>{" "}
                          &middot; {b.note}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">
                  Assign a cellular monitoring template to devices to collect
                  RSRP, RSRQ, and SINR.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4.5">
          <Card>
            <CardHeader className="flex-row items-start justify-between border-b border-border">
              <div>
                <CardTitle>Active remote sessions</CardTitle>
                <CardDescription>Encrypted LuCI and SSH tunnels</CardDescription>
              </div>
              {activeSessions.length > 0 && (
                <Badge variant="ok">
                  <span className="size-1.5 rounded-full bg-ok" />
                  {activeSessions.length} live
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {activeSessions.length > 0 ? (
                <ul className="divide-y divide-border">
                  {activeSessions.slice(0, 4).map((s) => {
                    const dev = devices.find((d) => d.id === s.device_id);
                    const isLuci =
                      s.protocol === "SSH_LUCI" || s.protocol === "HTTP_LUCI";
                    return (
                      <li
                        key={s.id}
                        className="flex items-center gap-2.5 px-4 py-2.5"
                      >
                        <Badge variant={isLuci ? "accent" : "neutral"}>
                          {isLuci ? "LuCI" : "SSH"}
                        </Badge>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[12px] text-foreground">
                            {dev?.name ||
                              dev?.serial_number ||
                              s.device_id.slice(0, 12)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            expires{" "}
                            {new Date(s.expires_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </span>
                        {dev && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              isLuci ? onOpenLuCI(dev) : onOpenTerminal(dev)
                            }
                          >
                            {isLuci ? (
                              <Globe className="size-3.5" />
                            ) : (
                              <TerminalSquare className="size-3.5" />
                            )}
                            Join
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <Cable className="size-6 text-muted-foreground" />
                  <p className="text-[12px] text-muted-foreground">
                    No active tunnels. Launch LuCI or a terminal from any online
                    device.
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter>
              <span>Auto-closes on idle</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-primary"
                onClick={() => onNavigate("sessions")}
              >
                All sessions <ArrowRight className="size-3.5" />
              </button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>Onboarding queue</CardTitle>
              <CardDescription>Devices moving into your workspace</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col divide-y divide-border p-0">
              <button
                type="button"
                onClick={() => onNavigate("registration-requests")}
                className="flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40"
              >
                <span className="font-display text-[20px] font-bold tabular-nums text-primary">
                  {awaitingCount}
                </span>
                <span className="text-[12px] text-foreground/80">
                  Awaiting device
                  <span className="block text-[10.5px] text-muted-foreground">
                    pre-registered, not yet connected
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate("available-to-claim")}
                className="flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40"
              >
                <span className="font-display text-[20px] font-bold tabular-nums text-warn">
                  {pendingCount}
                </span>
                <span className="text-[12px] text-foreground/80">
                  Available to claim
                  <span className="block text-[10.5px] text-muted-foreground">
                    connected, ready for ownership
                  </span>
                </span>
              </button>
            </CardContent>
          </Card>

          {groups.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-start justify-between border-b border-border">
                <CardTitle>Device groups</CardTitle>
                <button
                  type="button"
                  className="text-[12px] font-medium text-primary"
                  onClick={() => onNavigate("groups")}
                >
                  Manage
                </button>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {groups.slice(0, 4).map((g) => {
                  const gd = devices.filter((d) =>
                    (d.groups || []).includes(g.name)
                  );
                  const gOnline = gd.filter(
                    (d) => d.status === "ONLINE"
                  ).length;
                  const ratio =
                    gd.length > 0
                      ? Math.round((gOnline / gd.length) * 100)
                      : 100;
                  return (
                    <div
                      key={g.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-medium text-foreground">
                          {g.name}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground">
                          {(gd.length || g.device_count || 0).toLocaleString()}{" "}
                          routers assigned
                        </div>
                      </div>
                      <Badge variant={ratio === 100 ? "ok" : "warn"}>
                        {ratio}% ok
                      </Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
