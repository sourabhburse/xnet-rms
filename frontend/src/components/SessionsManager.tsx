import React, { useEffect, useMemo, useState } from "react";
import { Cable, Clock3, ExternalLink, RefreshCw, Router, TerminalSquare, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Device, SessionItem, User } from "../types";
import { api, formatApiError } from "../api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SessionsManagerProps {
  user: User;
  sessions: SessionItem[];
  devices: Device[];
  loading: boolean;
  onRefresh: () => void;
}

const sessionLabel = (protocol: SessionItem["protocol"]) => {
  if (protocol === "SSH_LUCI" || protocol === "HTTP_LUCI") return "LuCI";
  if (protocol === "TERMINAL_SSH") return "Terminal SSH";
  return protocol;
};

function formatDate(value?: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString();
}

function remaining(expiresAt: string, now: number) {
  const milliseconds = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "Expired";
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 1) return "Under 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Kpi({ label, value, note, tone = "neutral" }: { label: string; value: string | number; note: string; tone?: "neutral" | "ok" | "warn" }) {
  const valueClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-foreground";
  return (
    <div className="border-b border-r border-border p-5 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className={`mt-2 font-display text-[28px] font-semibold leading-none tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-2 text-[12px] text-muted-foreground">{note}</div>
    </div>
  );
}

export default function SessionsManager({ user, sessions, devices, loading, onRefresh }: SessionsManagerProps) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<SessionItem | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const activeSessions = useMemo(() => sessions.filter((session) => !session.closed_at), [sessions]);
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const expiringSoon = activeSessions.filter((session) => {
    const expiry = new Date(session.expires_at).getTime();
    return Number.isFinite(expiry) && expiry - now <= 5 * 60000;
  }).length;
  const terminalCount = activeSessions.filter((session) => session.protocol === "TERMINAL_SSH").length;
  const canManage = user.role !== "VIEWER";

  const closeSession = async () => {
    if (!closeTarget) return;
    setClosingId(closeTarget.id);
    try {
      await api(`sessions/${closeTarget.id}`, "DELETE");
      toast.success("Session closed");
      setCloseTarget(null);
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setClosingId(null);
    }
  };

  const extendSession = async (session: SessionItem) => {
    setExtendingId(session.id);
    try {
      await api(`sessions/${session.id}/extend`, "POST");
      toast.success("Session extended by 15 minutes");
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setExtendingId(null);
    }
  };

  return (
    <div className="-m-6 min-h-full bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-primary"><Cable className="size-3.5" />Remote access</div>
          <h1 className="mt-1 font-display text-[22px] font-semibold text-balance">Sessions</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground text-pretty">Monitor and end active LuCI and terminal connections across the fleet.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className="size-3.5" />Refresh</Button>
      </header>

      <div className="flex items-center border-b border-border px-6">
        <span className="border-b-2 border-primary px-3 py-3 text-[13px] font-medium text-primary">Active sessions <span className="ml-1 font-mono text-[11px] tabular-nums">{activeSessions.length}</span></span>
        <span className="px-3 py-3 text-[13px] text-muted-foreground">Closed history unavailable</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3">
        <Kpi label="Active now" value={activeSessions.length} note="Across the selected scope" tone="ok" />
        <Kpi label="Expiring soon" value={expiringSoon} note="Within the next five minutes" tone={expiringSoon ? "warn" : "neutral"} />
        <Kpi label="Capacity" value={`${activeSessions.length} / 25`} note={`${terminalCount} terminal · ${activeSessions.length - terminalCount} LuCI`} />
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-6 py-4">
          <div><h2 className="text-[14px] font-semibold">Active connections</h2><p className="mt-1 text-[12px] text-muted-foreground">Sessions expire after 15 minutes and can be extended up to one hour.</p></div>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Live access ledger</span>
        </div>
          {loading ? (
            <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading sessions">{[1, 2, 3].map((row) => <div key={row} className="grid grid-cols-4 gap-4"><span className="h-4 rounded bg-secondary" /><span className="h-4 rounded bg-secondary" /><span className="h-4 rounded bg-secondary" /><span className="h-4 rounded bg-secondary" /></div>)}</div>
          ) : activeSessions.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Device</TableHead><TableHead>Opened by</TableHead><TableHead>Started</TableHead><TableHead>Expires</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{activeSessions.map((session) => {
                  const device = deviceById.get(session.device_id);
                  const expiry = new Date(session.expires_at).getTime();
                  const isExpiring = Number.isFinite(expiry) && expiry - now > 0 && expiry - now <= 5 * 60000;
                  return <TableRow key={session.id} className={isExpiring ? "border-l-2 border-l-warn-rail bg-warn-bg/20" : "border-l-2 border-l-ok-rail"}>
                    <TableCell><span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{session.protocol === "TERMINAL_SSH" ? <TerminalSquare className="size-3.5 text-primary" /> : <Cable className="size-3.5 text-primary" />}{sessionLabel(session.protocol)}</span></TableCell>
                    <TableCell><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-md bg-accent text-accent-foreground"><Router className="size-3.5" /></span><span className="min-w-0"><span className="block max-w-[220px] truncate text-[13px] font-medium">{device?.name || device?.serial_number || "Unknown device"}</span><span className="block font-mono text-[10.5px] text-muted-foreground">{device?.serial_number || session.device_id}</span></span></div></TableCell>
                    <TableCell className="font-mono text-[11px]">{session.user_id === user.id ? "You" : session.user_id.slice(0, 12)}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{formatDate(session.created_at)}</TableCell>
                    <TableCell><div className={isExpiring ? "text-warn" : "text-foreground"}><div className="flex items-center gap-1.5 font-mono text-[11px]"><Clock3 className="size-3.5" />{remaining(session.expires_at, now)}</div><div className="mt-1 text-[11px] text-muted-foreground">{formatDate(session.expires_at)}</div></div></TableCell>
                    <TableCell><div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={!canManage || extendingId === session.id || closingId === session.id} onClick={() => extendSession(session)}>Extend</Button><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={!canManage || closingId === session.id || extendingId === session.id} onClick={() => setCloseTarget(session)}><XCircle className="size-3.5" />Close</Button></div></TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 p-6 text-center"><span className="grid size-10 place-items-center rounded-full bg-secondary"><Cable className="size-5 text-muted-foreground" /></span><p className="text-[13px] font-medium">No active sessions</p><p className="max-w-sm text-xs text-muted-foreground text-pretty">Open LuCI or terminal from an online device to create a secure, time-limited session.</p></div>
          )}
      </section>

      <div className="flex items-start gap-2 border-t border-border bg-secondary/25 px-6 py-3 text-[12px] text-muted-foreground"><ExternalLink className="mt-0.5 size-3.5 shrink-0" /><span>Closed-session history and close outcomes are not exposed by the current sessions API, so no historical rows are shown here.</span></div>
      <ConfirmDialog open={!!closeTarget} onOpenChange={(open) => !open && setCloseTarget(null)} title="Terminate remote session?" description="The active router connection will be dropped immediately." confirmLabel="Close session" onConfirm={closeSession} />
    </div>
  );
}
