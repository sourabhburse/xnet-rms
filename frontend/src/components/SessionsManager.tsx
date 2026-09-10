import React, { useState } from "react";
import { Cable, Clock3, RefreshCw, Router, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Device, SessionItem, User } from "../types";
import { api, formatApiError } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SessionsManagerProps { user: User; sessions: SessionItem[]; devices: Device[]; loading: boolean; onRefresh: () => void; }

export default function SessionsManager({ sessions, devices, loading, onRefresh }: SessionsManagerProps) {
  const [closingId, setClosingId] = useState<string | null>(null);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<SessionItem | null>(null);
  const getDeviceSerial = (deviceId: string) => devices.find((device) => device.id === deviceId)?.serial_number || deviceId;
  const closeSession = async () => {
    if (!closeTarget) return;
    setClosingId(closeTarget.id);
    try { await api(`sessions/${closeTarget.id}`, "DELETE"); toast.success("Session closed successfully"); setCloseTarget(null); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setClosingId(null); }
  };
  const extendSession = async (session: SessionItem) => {
    setExtendingId(session.id);
    try { await api(`sessions/${session.id}/extend`, "POST"); toast.success("Session extended by 15 minutes"); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setExtendingId(null); }
  };

  return <div className="mx-auto flex max-w-[1200px] flex-col gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-[20px] font-semibold">Active remote sessions</h1><p className="mt-1 text-[13px] text-muted-foreground">SSH tunnels and LuCI proxy sessions across connected routers · system capacity: 25 concurrent.</p></div><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button></div>
    <Card><CardHeader className="border-b border-border"><CardTitle className="flex items-center gap-2"><Cable className="size-4 text-primary" />Remote sessions</CardTitle><CardDescription>{sessions.length} session{sessions.length === 1 ? "" : "s"} currently tracked. Sessions can be extended in 15-minute increments up to one hour total.</CardDescription></CardHeader><CardContent className="p-0">{loading ? <div className="p-8 text-center text-xs text-muted-foreground">Loading sessions…</div> : sessions.length ? <Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Protocol</TableHead><TableHead>Session ID</TableHead><TableHead>Expires</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{sessions.map((session) => <TableRow key={session.id}><TableCell><div className="flex items-center gap-2"><Router className="size-4 text-primary" /><span className="font-mono text-[11px] font-semibold">{getDeviceSerial(session.device_id)}</span></div></TableCell><TableCell><Badge variant={session.protocol === "TERMINAL_SSH" ? "accent" : "secondary"} className="font-normal">{session.protocol === "SSH_LUCI" ? "LuCI" : session.protocol === "TERMINAL_SSH" ? "Terminal SSH" : session.protocol}</Badge></TableCell><TableCell className="max-w-[200px] truncate font-mono text-[10.5px] text-muted-foreground" title={session.id}>{session.id}</TableCell><TableCell><span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground"><Clock3 className="size-3.5" />{session.expires_at ? new Date(session.expires_at).toLocaleTimeString() : "—"}</span></TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={extendingId === session.id} onClick={() => extendSession(session)}>Extend 15 min</Button><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={closingId === session.id || extendingId === session.id} onClick={() => setCloseTarget(session)}><XCircle className="size-3.5" />Close session</Button></div></TableCell></TableRow>)}</TableBody></Table> : <div className="flex min-h-36 flex-col items-center justify-center gap-1 p-6 text-center"><Cable className="mb-1 size-5 text-muted-foreground/50" /><p className="text-[13px] font-medium">No active remote sessions</p><p className="text-xs text-muted-foreground">Sessions opened from LuCI or terminal will appear here.</p></div>}</CardContent></Card>
    <ConfirmDialog open={!!closeTarget} onOpenChange={(open) => !open && setCloseTarget(null)} title="Terminate remote session?" description="The active connection will be dropped immediately." confirmLabel="Close session" onConfirm={closeSession} />
  </div>;
}
