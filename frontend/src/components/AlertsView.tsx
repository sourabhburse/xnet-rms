import React, { useEffect, useState } from "react";
import { BellRing, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { AlertItem, User } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const selectClass = "h-9 rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none";
interface EventItem { id: number; event: string; severity: string; value: unknown; actor_id?: string; occurred_at: string }

export default function AlertsView({ user, selectedOrg, onUnreadChange }: { user: User; selectedOrg: string; onUnreadChange: (count: number) => void }) {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const canAcknowledge = user.role !== "VIEWER";
  const refresh = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedOrg) params.set("organization_id", selectedOrg);
      if (status) params.set("status", status);
      if (severity) params.set("severity", severity);
      const result = await api<{ items: AlertItem[]; unacknowledged: number }>(`alerts?${params}`);
      setItems(result.items || []); onUnreadChange(result.unacknowledged || 0);
    } catch (err) { toast.error(formatApiError(err).message); } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [selectedOrg, status, severity]);
  const inspect = async (item: AlertItem) => {
    setSelected(item);
    try { const result = await api<{ alert: AlertItem; events: EventItem[] }>(`alerts/${item.id}`); setSelected(result.alert); setEvents(result.events || []); }
    catch (err) { toast.error(formatApiError(err).message); }
  };
  const acknowledge = async (item: AlertItem) => {
    try { await api(`alerts/${item.id}/acknowledge`, "POST", {}); toast.success("Alert acknowledged; health evaluation continues"); await refresh(); if (selected?.id === item.id) inspect(item); }
    catch (err) { toast.error(formatApiError(err).message); }
  };
  return <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><BellRing className="size-4" /></span><div><h1 className="font-display text-[20px] font-semibold">Alert center</h1><p className="mt-1 text-[13px] text-muted-foreground">Persistent health alerts with debounce, acknowledgement, automatic recovery, and audit history.</p></div></div><Button variant="outline" size="sm" onClick={refresh}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button></div>
    <Card><CardContent className="flex flex-wrap gap-2 p-3"><select className={selectClass} value={status} onChange={event => setStatus(event.target.value)}><option value="">All states</option><option value="OPEN">Open</option><option value="PENDING">Pending</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option></select><select className={selectClass} value={severity} onChange={event => setSeverity(event.target.value)}><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option></select></CardContent></Card>
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]"><Card><CardHeader className="border-b border-border"><CardTitle>Alerts</CardTitle><CardDescription>Two violating samples open or escalate; two healthy samples resolve.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Device / metric</TableHead><TableHead>Severity</TableHead><TableHead>State</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id} className="cursor-pointer" onClick={() => inspect(item)}><TableCell><div className="font-medium">{item.device_name}</div><div className="font-mono text-[10.5px] text-muted-foreground">{item.metric_id}{item.entity_key ? ` · ${item.entity_key}` : ""}</div></TableCell><TableCell><Badge variant={item.severity === "critical" ? "down" : "secondary"}>{item.severity}</Badge></TableCell><TableCell>{item.status}</TableCell><TableCell className="whitespace-nowrap font-mono text-[10px]">{new Date(item.updated_at).toLocaleString()}</TableCell><TableCell className="text-right">{canAcknowledge && item.status === "OPEN" && <Button size="sm" variant="outline" onClick={event => { event.stopPropagation(); acknowledge(item); }}><Check className="size-3.5" />Acknowledge</Button>}</TableCell></TableRow>)}{!items.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-xs text-muted-foreground">{loading ? "Loading…" : "No alerts match these filters."}</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
      <Card><CardHeader className="border-b border-border"><CardTitle>Alert details</CardTitle><CardDescription>{selected ? `${selected.template_name} v${selected.template_version}` : "Select an alert to inspect its lifecycle."}</CardDescription></CardHeader><CardContent className="space-y-3 p-4">{selected ? <><div className="rounded-md bg-secondary p-3 text-xs"><div className="font-medium">{selected.device_name}</div><div className="mt-1 font-mono">{selected.metric_id}{selected.entity_key ? ` / ${selected.entity_key}` : ""}</div><div className="mt-2 break-all text-muted-foreground">Last value: {JSON.stringify(selected.last_value)}</div>{selected.resolution_reason && <div className="mt-1">Resolution: {selected.resolution_reason}</div>}</div><div className="space-y-2">{events.map(event => <div key={event.id} className="border-l-2 border-border pl-3 text-[11px]"><div className="font-medium">{event.event} · {event.severity}</div><div className="text-muted-foreground">{new Date(event.occurred_at).toLocaleString()}</div></div>)}</div></> : <p className="text-xs text-muted-foreground">Lifecycle events are append-only and retained with telemetry summaries.</p>}</CardContent></Card>
    </div>
  </div>;
}
