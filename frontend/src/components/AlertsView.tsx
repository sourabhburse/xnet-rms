import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BellRing, Check, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { AlertItem, User } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface EventItem { id: number; event: string; severity: string; value: unknown; actor_id?: string; occurred_at: string }
type AlertTab = "all" | "active" | "acknowledged" | "resolved";

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "No value reported";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} values reported`;
  return "Structured value reported";
}

function eventLabel(event: string) {
  return event.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusLabel(status: AlertItem["status"]) {
  if (status === "PENDING") return "Pending";
  if (status === "OPEN") return "Open";
  if (status === "ACKNOWLEDGED") return "Acknowledged";
  return "Resolved";
}

function statusVariant(status: AlertItem["status"]) {
  if (status === "OPEN") return "down" as const;
  if (status === "PENDING") return "warn" as const;
  if (status === "ACKNOWLEDGED") return "accent" as const;
  return "ok" as const;
}

function timeLabel(value?: string) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString();
}

export default function AlertsView({ user, selectedOrg, onUnreadChange }: { user: User; selectedOrg: string; onUnreadChange: (count: number) => void }) {
  const [items, setItems] = useState<AlertItem[]>([]);
  const [tab, setTab] = useState<AlertTab>("all");
  const [severity, setSeverity] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const canAcknowledge = user.role !== "VIEWER";

  const refresh = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedOrg) params.set("organization_id", selectedOrg);
      if (severity) params.set("severity", severity);
      const result = await api<{ items: AlertItem[]; unacknowledged: number }>(`alerts?${params}`);
      setItems(result.items || []);
      onUnreadChange(result.unacknowledged || 0);
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [selectedOrg, tab, severity]);

  const counts = useMemo(() => ({
    all: items.length,
    active: items.filter((item) => item.status === "OPEN" || item.status === "PENDING").length,
    acknowledged: items.filter((item) => item.status === "ACKNOWLEDGED").length,
    resolved: items.filter((item) => item.status === "RESOLVED").length,
  }), [items]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const tabMatches = tab === "all" || (tab === "active" ? item.status === "OPEN" || item.status === "PENDING" : item.status === tab.toUpperCase());
      const queryMatches = !needle || `${item.device_name} ${item.metric_id} ${item.entity_key}`.toLowerCase().includes(needle);
      return tabMatches && queryMatches;
    });
  }, [items, query, tab]);

  const inspect = async (item: AlertItem) => {
    setSelected(item);
    try {
      const result = await api<{ alert: AlertItem; events: EventItem[] }>(`alerts/${item.id}`);
      setSelected(result.alert);
      setEvents(result.events || []);
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  const acknowledge = async (item: AlertItem) => {
    try {
      await api(`alerts/${item.id}/acknowledge`, "POST", {});
      toast.success("Alert acknowledged; health evaluation continues");
      await refresh();
      if (selected?.id === item.id) await inspect(item);
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-primary"><BellRing className="size-3.5" />Monitoring</div>
          <h1 className="mt-1 font-display text-[22px] font-semibold text-balance">Alerts</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground text-pretty">Review active health conditions, acknowledge ownership, and inspect the lifecycle recorded by the monitoring service.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />Refresh</Button>
      </header>

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:grid-cols-4">
        {(["all", "active", "acknowledged", "resolved"] as AlertTab[]).map((value) => <button key={value} type="button" onClick={() => setTab(value)} className={`border-b-2 px-4 py-3 text-left ${tab === value ? "border-primary bg-accent/40" : "border-transparent hover:bg-secondary/40"}`}><span className="block text-[11px] font-semibold uppercase text-muted-foreground">{value === "all" ? "All alerts" : value}</span><span className="mt-1 block font-display text-[24px] font-semibold tabular-nums">{counts[value]}</span></button>)}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-[360px]"><Input aria-label="Search alerts" placeholder="Search device or metric" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <select aria-label="Filter alert severity" className="h-9 rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option></select>
          {(query || severity) && <button type="button" className="text-[12px] font-medium text-primary hover:underline" onClick={() => { setQuery(""); setSeverity(""); }}>Clear filters</button>}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="border-b border-border"><CardTitle>Alert queue</CardTitle><CardDescription>Every row is a current alert state; acknowledgement does not resolve the condition.</CardDescription></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table><TableHeader><TableRow><TableHead>Condition</TableHead><TableHead>Severity</TableHead><TableHead>State</TableHead><TableHead>Last updated</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
                {visibleItems.map((item) => <TableRow key={item.id} className="cursor-pointer border-l-2 border-l-transparent hover:border-l-primary hover:bg-secondary/30" onClick={() => void inspect(item)}>
                  <TableCell><div className="max-w-[360px]"><div className="truncate text-[13px] font-medium">{item.device_name}</div><div className="mt-1 truncate text-[11px] text-muted-foreground">{item.metric_id}{item.entity_key ? ` · ${item.entity_key}` : ""} · reported {formatValue(item.last_value)}</div></div></TableCell>
                  <TableCell><Badge variant={item.severity === "critical" ? "down" : "warn"}>{item.severity}</Badge></TableCell>
                  <TableCell><Badge variant={statusVariant(item.status)}><span className="size-1.5 rounded-full bg-current" />{statusLabel(item.status)}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">{timeLabel(item.updated_at)}</TableCell>
                  <TableCell className="text-right">{canAcknowledge && item.status === "OPEN" && <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); void acknowledge(item); }}><Check className="size-3.5" />Acknowledge</Button>}</TableCell>
                </TableRow>)}
                {!visibleItems.length && <TableRow><TableCell colSpan={5} className="h-36 text-center"><div className="flex flex-col items-center gap-2"><span className="grid size-9 place-items-center rounded-full bg-secondary"><ShieldCheck className="size-4 text-ok" /></span><span className="text-[13px] font-medium">{loading ? "Loading alerts…" : "No alerts in this view"}</span><span className="text-xs text-muted-foreground">{query || severity ? "Try clearing a filter." : "The monitoring service has not reported a matching condition."}</span></div></TableCell></TableRow>}
              </TableBody></Table>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="border-b border-border"><CardTitle>Alert details</CardTitle><CardDescription>{selected ? `${selected.template_name} · v${selected.template_version}` : "Select an alert to inspect its lifecycle."}</CardDescription></CardHeader>
          <CardContent className="space-y-4 p-4">
            {selected ? <>
              <div className="rounded-lg border border-border bg-secondary/40 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-[13px] font-semibold">{selected.device_name}</div><div className="mt-1 font-mono text-[10.5px] text-muted-foreground">{selected.metric_id}{selected.entity_key ? ` / ${selected.entity_key}` : ""}</div></div><Badge variant={statusVariant(selected.status)}>{statusLabel(selected.status)}</Badge></div><div className="mt-4 grid grid-cols-2 gap-3 text-[11px]"><div><span className="block text-muted-foreground">Severity</span><span className="mt-1 block font-medium capitalize">{selected.severity}</span></div><div><span className="block text-muted-foreground">Last value</span><span className="mt-1 block font-mono">{formatValue(selected.last_value)}</span></div></div></div>
              <div><div className="mb-2 flex items-center gap-2 text-[12px] font-semibold"><Clock3 className="size-3.5 text-primary" />Lifecycle</div><div className="space-y-3">{events.length ? events.map((event) => <div key={event.id} className="relative border-l-2 border-border pl-3 text-[11px]"><div className="font-medium">{eventLabel(event.event)}</div><div className="mt-0.5 text-muted-foreground">{timeLabel(event.occurred_at)}</div></div>) : <p className="text-xs text-muted-foreground">No lifecycle events returned for this alert.</p>}</div></div>
              {canAcknowledge && selected.status === "OPEN" && <Button className="w-full" variant="outline" onClick={() => void acknowledge(selected)}><Check className="size-3.5" />Acknowledge alert</Button>}
            </> : <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><AlertTriangle className="size-5 text-muted-foreground/60" /><p className="text-[13px] font-medium">Nothing selected</p><p className="text-xs text-muted-foreground text-pretty">Choose a row to view its recorded lifecycle and current value.</p></div>}
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border border-border bg-secondary/40 px-3.5 py-3 text-[12px] text-muted-foreground">Trend charts and rule editing are not shown because the current API exposes alert state and lifecycle events, but not historical chart series or rule mutation endpoints.</div>
    </div>
  );
}
