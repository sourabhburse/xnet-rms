import React, { useEffect, useMemo, useState } from "react";
import { Download, FileBarChart, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { Device, DeviceGroup, MonitoringTemplate, TagItem, TelemetryAggregate, TelemetryReport } from "../types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Scope = "device" | "group" | "tag";
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none";
const aggregateValue = (field: TelemetryAggregate) => field.kind === "counter" && field.delta_samples ? field.delta : field.average ?? field.last;
const display = (value: unknown, unit = "") => value === null || value === undefined || value === "" ? "—" : `${typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : String(value)}${unit ? ` ${unit}` : ""}`;

export default function ReportsView({ devices, groups, tags, selectedOrg }: { devices: Device[]; groups: DeviceGroup[]; tags: TagItem[]; selectedOrg: string }) {
  const [scope, setScope] = useState<Scope>(devices.length ? "device" : "group");
  const [scopeID, setScopeID] = useState(devices[0]?.id || groups[0]?.id || tags[0]?.id || "");
  const [days, setDays] = useState("30");
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [resolution, setResolution] = useState<"hour" | "day">("hour");
  const [templates, setTemplates] = useState<MonitoringTemplate[]>([]);
  const [templateID, setTemplateID] = useState("");
  const [metricIDs, setMetricIDs] = useState<string[]>([]);
  const [report, setReport] = useState<TelemetryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldID, setFieldID] = useState("");

  useEffect(() => { api<MonitoringTemplate[]>(`monitoring/templates${selectedOrg ? `?organization_id=${encodeURIComponent(selectedOrg)}` : ""}`).then(setTemplates).catch(() => setTemplates([])); }, [selectedOrg]);
  const visibleGroups = groups.filter(item => !selectedOrg || item.organization_id === selectedOrg);
  const visibleTags = tags.filter(item => !selectedOrg || item.organization_id === selectedOrg);
  const scopeItems = scope === "device" ? devices : scope === "group" ? visibleGroups : visibleTags;
  const selectedTemplate = templates.find(item => item.id === templateID);
  const selectedTemplateMetrics = Array.isArray(selectedTemplate?.definition?.metrics) ? selectedTemplate.definition.metrics : [];
  const fields = useMemo(() => {
    const values = new Map<string, TelemetryAggregate>();
    (report?.items || []).forEach(item => Object.entries(item.fields || {}).forEach(([id, field]) => values.set(id, field)));
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [report]);
  const selectedField = fieldID || fields[0]?.[0] || "";
  const request = () => {
    const custom = days === "custom";
    return { organization_id: selectedOrg || undefined, scope_type: scope, scope_id: scopeID, template_id: templateID || undefined, metric_ids: metricIDs, from: custom ? new Date(`${fromDate}T00:00:00`).toISOString() : new Date(Date.now() - Number(days) * 86400000).toISOString(), to: custom ? new Date(`${toDate}T23:59:59.999`).toISOString() : new Date().toISOString(), resolution, page_size: 1000 };
  };
  const runReport = async () => {
    if (!scopeID) { toast.warning("Choose a report scope first."); return; }
    setLoading(true);
    try { setReport(await api<TelemetryReport>("reports/telemetry/query", "POST", request())); setFieldID(""); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setLoading(false); }
  };
  const exportCSV = async () => {
    if (!scopeID) return;
    try {
      const response = await fetch("/api/v1/reports/telemetry/export.csv", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request()) });
      if (!response.ok) throw new Error("CSV export failed");
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = `xnet-telemetry-${days === "custom" ? `${fromDate}-${toDate}` : `${days}d`}.csv`; link.click(); URL.revokeObjectURL(url);
    } catch (err) { toast.error(formatApiError(err).message); }
  };
  const chartPoints = scope === "device" && selectedField ? (report?.items || []).filter(item => item.fields[selectedField]).map(item => ({ bucket: item.bucket, value: aggregateValue(item.fields[selectedField]) })) : [];

  return <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><FileBarChart className="size-4" /></span><div><h1 className="font-display text-[20px] font-semibold">Telemetry reports</h1><p className="mt-1 text-[13px] text-muted-foreground">Scoped hourly/daily telemetry, availability, counters, states, and alert history.</p></div></div><Button variant="outline" size="sm" onClick={runReport} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button></div>
    <Card><CardHeader className="border-b border-border"><CardTitle>Report scope</CardTitle><CardDescription>Raw data defaults to 30 days; hourly summaries, heartbeat presence, and alerts default to 365 days.</CardDescription></CardHeader><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Scope</label><select className={selectClass} value={scope} onChange={event => { const value = event.target.value as Scope; setScope(value); setScopeID((value === "device" ? devices[0]?.id : value === "group" ? visibleGroups[0]?.id : visibleTags[0]?.id) || ""); }}><option value="device">Device</option><option value="group">Group</option><option value="tag">Tag</option></select></div>
      <div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Target</label><select className={selectClass} value={scopeID} onChange={event => setScopeID(event.target.value)}><option value="">Select target</option>{scopeItems.map(item => <option key={item.id} value={item.id}>{"serial_number" in item ? `${item.name || item.serial_number} · ${item.serial_number}` : item.name}</option>)}</select></div>
      <div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Template</label><select className={selectClass} value={templateID} onChange={event => { setTemplateID(event.target.value); setMetricIDs([]); }}><option value="">All telemetry</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Period</label><select className={selectClass} value={days} onChange={event => setDays(event.target.value)}><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="366">366 days</option><option value="custom">Custom dates</option></select></div>
      <div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Resolution</label><select className={selectClass} value={resolution} onChange={event => setResolution(event.target.value as "hour" | "day")}><option value="hour">Hourly</option><option value="day">Daily</option></select></div>
      {days === "custom" && <><div><label className="text-[11px] font-semibold uppercase text-muted-foreground">From date</label><input className={selectClass} type="date" value={fromDate} max={toDate} onChange={event => setFromDate(event.target.value)} /></div><div><label className="text-[11px] font-semibold uppercase text-muted-foreground">To date</label><input className={selectClass} type="date" value={toDate} min={fromDate} max={new Date().toISOString().slice(0, 10)} onChange={event => setToDate(event.target.value)} /></div></>}
      {selectedTemplate && <div className="sm:col-span-2 lg:col-span-5"><div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Metrics (none selects all)</div><div className="flex flex-wrap gap-2">{selectedTemplateMetrics.map(metric => <label key={metric.metric_id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px]"><input type="checkbox" checked={metricIDs.includes(metric.metric_id)} onChange={event => setMetricIDs(current => event.target.checked ? [...current, metric.metric_id] : current.filter(id => id !== metric.metric_id))} />{metric.label || metric.metric_id}</label>)}</div></div>}
      <div className="sm:col-span-2 lg:col-span-5"><Button onClick={runReport} disabled={loading || !scopeID}><Play className="size-4" />{loading ? "Generating…" : "Generate report"}</Button></div>
    </CardContent></Card>
    {!report ? <Card><CardContent className="flex min-h-40 items-center justify-center text-xs text-muted-foreground">Choose a scope and generate a report.</CardContent></Card> : <>
      <div className="grid gap-3 sm:grid-cols-4"><Summary label="Rows" value={report.items.length} /><Summary label="Devices" value={new Set(report.items.map(item => item.device_id)).size} /><Summary label="Alerts" value={report.alerts?.count || 0} note={report.alerts?.current_state || "healthy"} /><Card><CardContent className="flex items-center justify-between p-4"><div><div className="text-[11px] uppercase text-muted-foreground">Window</div><div className="mt-1 text-sm font-semibold">{days === "custom" ? `${fromDate} – ${toDate}` : `${days} days`}</div></div><Button variant="outline" size="sm" onClick={exportCSV}><Download className="size-3.5" />CSV</Button></CardContent></Card></div>
      {scope === "device" && <Card><CardHeader className="border-b border-border"><CardTitle>Metric trend</CardTitle></CardHeader><CardContent className="p-4"><select className={selectClass + " mb-3 max-w-[360px]"} value={selectedField} onChange={event => setFieldID(event.target.value)}>{fields.map(([id, field]) => <option key={id} value={id}>{field.label || id}</option>)}</select><div className="max-h-56 overflow-auto rounded-md border border-border">{chartPoints.map(point => <div key={`${point.bucket}-${selectedField}`} className="flex justify-between border-b border-border px-3 py-2 text-[11px]"><span>{new Date(point.bucket).toLocaleString()}</span><span className="font-mono">{display(point.value, fields.find(([id]) => id === selectedField)?.[1].unit)}</span></div>)}</div></CardContent></Card>}
      <Card><CardHeader className="border-b border-border"><CardTitle>Report data</CardTitle><CardDescription>{report.resolution || report.bucket} aggregates; use CSV for the full paginated export.</CardDescription></CardHeader><CardContent className="p-0"><div className="max-h-[520px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Bucket</TableHead><TableHead>Metric</TableHead><TableHead>Value</TableHead><TableHead>Range / delta</TableHead></TableRow></TableHeader><TableBody>{report.items.flatMap(item => Object.entries(item.fields).map(([id, field]) => <TableRow key={`${item.device_id}-${item.source_id}-${item.bucket}-${id}`}><TableCell><div>{item.device_name}</div><div className="font-mono text-[10px] text-muted-foreground">{item.source_id}</div></TableCell><TableCell className="font-mono text-[10px]">{new Date(item.bucket).toLocaleString()}</TableCell><TableCell>{field.label || id}</TableCell><TableCell className="font-mono text-[11px]">{display(aggregateValue(field), field.unit)}</TableCell><TableCell className="font-mono text-[10px] text-muted-foreground">{field.min != null || field.max != null ? `${field.min ?? "—"} – ${field.max ?? "—"}` : field.delta_samples ? `Δ ${field.delta ?? 0}${field.resets ? ` · ${field.resets} resets` : ""}` : field.state_seconds ? JSON.stringify(field.state_seconds) : "—"}</TableCell></TableRow>))}</TableBody></Table></div></CardContent></Card>
    </>}
  </div>;
}

function Summary({ label, value, note }: { label: string; value: number; note?: string }) { return <Card><CardContent className="p-4"><div className="text-[11px] uppercase text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div>{note && <div className="text-[10px] text-muted-foreground">{note}</div>}</CardContent></Card>; }
