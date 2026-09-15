import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, Download, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { api, formatApiError } from "../api";
import { Device, DeviceGroup, MonitoringTemplate, TagItem, TelemetryAggregate, TelemetryReport } from "../types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Scope = "device" | "group" | "tag";
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

function aggregateValue(field: TelemetryAggregate) {
  return field.kind === "counter" && field.delta_samples ? field.delta : field.average ?? field.last;
}

function display(value: unknown, unit = "") {
  if (value === null || value === undefined || value === "") return "—";
  const rendered = typeof value === "number" && !Number.isInteger(value) ? value.toFixed(1) : String(value);
  return unit ? `${rendered} ${unit}` : rendered;
}

function formatBucket(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Summary({ label, value, note, tone = "neutral" }: { label: string; value: string | number; note: string; tone?: "neutral" | "ok" | "warn" }) {
  const valueClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-foreground";
  return <Card className="rounded-none border-0 border-b border-r border-border shadow-none last:border-r-0"><CardContent className="p-4"><div className="font-mono text-[11px] uppercase text-muted-foreground">{label}</div><div className={`mt-2 font-display text-[25px] font-semibold leading-none tabular-nums ${valueClass}`}>{value}</div><div className="mt-2 text-[12px] text-muted-foreground">{note}</div></CardContent></Card>;
}

export default function ReportsView({ devices, groups, tags, selectedOrg }: { devices: Device[]; groups: DeviceGroup[]; tags: TagItem[]; selectedOrg: string }) {
  const [scope, setScope] = useState<Scope>(devices.length ? "device" : "group");
  const [scopeID, setScopeID] = useState(devices[0]?.id || groups[0]?.id || tags[0]?.id || "");
  const [days, setDays] = useState("30");
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [resolution, setResolution] = useState<"hour" | "day">("day");
  const [templates, setTemplates] = useState<MonitoringTemplate[]>([]);
  const [templateID, setTemplateID] = useState("");
  const [metricIDs, setMetricIDs] = useState<string[]>([]);
  const [selectedField, setSelectedField] = useState("");
  const [report, setReport] = useState<TelemetryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("telemetry");

  useEffect(() => { void api<MonitoringTemplate[]>(`monitoring/templates${selectedOrg ? `?organization_id=${encodeURIComponent(selectedOrg)}` : ""}`).then(setTemplates).catch(() => setTemplates([])); }, [selectedOrg]);

  const visibleGroups = groups.filter((item) => !selectedOrg || item.organization_id === selectedOrg);
  const visibleTags = tags.filter((item) => !selectedOrg || item.organization_id === selectedOrg);
  const scopeItems = scope === "device" ? devices : scope === "group" ? visibleGroups : visibleTags;
  const selectedTemplate = templates.find((item) => item.id === templateID);

  useEffect(() => {
    if (!scopeItems.some((item) => item.id === scopeID)) setScopeID(scopeItems[0]?.id || "");
  }, [scopeItems, scopeID]);

  const fields = useMemo(() => {
    const values = new Map<string, TelemetryAggregate>();
    (report?.items || []).forEach((item) => Object.entries(item.fields || {}).forEach(([id, field]) => values.set(id, field)));
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [report]);
  const fieldID = selectedField || fields[0]?.[0] || "";
  const field = fields.find(([id]) => id === fieldID)?.[1];
  const chartPoints = useMemo(() => (report?.items || []).map((item) => {
    const aggregate = item.fields[fieldID];
    const value = aggregate ? aggregateValue(aggregate) : null;
    return { bucket: item.bucket, label: formatBucket(item.bucket), value: typeof value === "number" ? value : null };
  }).filter((item): item is { bucket: string; label: string; value: number } => item.value !== null), [fieldID, report]);

  const request = () => {
    const custom = days === "custom";
    return { organization_id: selectedOrg || undefined, scope_type: scope, scope_id: scopeID, template_id: templateID || undefined, metric_ids: metricIDs, from: custom ? new Date(`${fromDate}T00:00:00`).toISOString() : new Date(Date.now() - Number(days) * 86400000).toISOString(), to: custom ? new Date(`${toDate}T23:59:59.999`).toISOString() : new Date().toISOString(), resolution, page_size: 1000 };
  };

  const runReport = async () => {
    if (!scopeID) { toast.warning("Choose a report scope first."); return; }
    setLoading(true);
    try { setReport(await api<TelemetryReport>("reports/telemetry/query", "POST", request())); setSelectedField(""); setActiveTab("telemetry"); }
    catch (err) { toast.error(formatApiError(err).message); }
    finally { setLoading(false); }
  };

  const exportCSV = async () => {
    if (!scopeID) return;
    try {
      const response = await fetch("/api/v1/reports/telemetry/export.csv", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request()) });
      if (!response.ok) throw new Error("CSV export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `xnet-telemetry-${days === "custom" ? `${fromDate}-${toDate}` : `${days}d`}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast.error(formatApiError(err).message); }
  };

  const reportRows = report?.items.flatMap((item) => Object.entries(item.fields).filter(([id]) => !fieldID || id === fieldID).map(([id, aggregate]) => ({ item, id, aggregate }))) || [];
  const distinctDevices = new Set((report?.items || []).map((item) => item.device_id)).size;
  const alertCount = report?.alerts?.count || 0;

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-primary"><BarChart3 className="size-3.5" />Monitoring</div><h1 className="mt-1 font-display text-[22px] font-semibold text-balance">Reports</h1><p className="mt-1 max-w-2xl text-[13px] text-muted-foreground text-pretty">Explore telemetry aggregates for a device, group, or tag over a controlled reporting window.</p></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void runReport()} disabled={loading}><RefreshCw className="size-3.5" />Refresh</Button><Button variant="outline" size="sm" onClick={() => void exportCSV()} disabled={!report || loading}><Download className="size-3.5" />Export CSV</Button></div>
      </header>

      <Card>
        <CardHeader className="border-b border-border"><CardTitle>Report controls</CardTitle><CardDescription>All displayed values come from the telemetry query endpoint. Choose one metric to drive the chart and table.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[11px] font-semibold uppercase text-muted-foreground">Scope<select aria-label="Report scope" className={`mt-1 ${selectClass}`} value={scope} onChange={(event) => { const value = event.target.value as Scope; setScope(value); const nextItems = value === "device" ? devices : value === "group" ? visibleGroups : visibleTags; setScopeID(nextItems[0]?.id || ""); setReport(null); }}><option value="device">Device</option><option value="group">Group</option><option value="tag">Tag</option></select></label>
          <label className="text-[11px] font-semibold uppercase text-muted-foreground">Target<select aria-label="Report target" className={`mt-1 ${selectClass}`} value={scopeID} onChange={(event) => setScopeID(event.target.value)}><option value="">Select target</option>{scopeItems.map((item) => <option key={item.id} value={item.id}>{"serial_number" in item ? `${item.name || item.serial_number} · ${item.serial_number}` : item.name}</option>)}</select></label>
          <label className="text-[11px] font-semibold uppercase text-muted-foreground">Template<select aria-label="Monitoring template" className={`mt-1 ${selectClass}`} value={templateID} onChange={(event) => { setTemplateID(event.target.value); setMetricIDs([]); }}><option value="">All telemetry</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-[11px] font-semibold uppercase text-muted-foreground">Window<select aria-label="Report window" className={`mt-1 ${selectClass}`} value={days} onChange={(event) => setDays(event.target.value)}><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="366">366 days</option><option value="custom">Custom dates</option></select></label>
          <label className="text-[11px] font-semibold uppercase text-muted-foreground">Resolution<select aria-label="Report resolution" className={`mt-1 ${selectClass}`} value={resolution} onChange={(event) => setResolution(event.target.value as "hour" | "day")}><option value="hour">Hourly</option><option value="day">Daily</option></select></label>
          {days === "custom" && <><label className="text-[11px] font-semibold uppercase text-muted-foreground">From<input aria-label="Report start date" className={`mt-1 ${selectClass}`} type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="text-[11px] font-semibold uppercase text-muted-foreground">To<input aria-label="Report end date" className={`mt-1 ${selectClass}`} type="date" value={toDate} min={fromDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setToDate(event.target.value)} /></label></>}
          {selectedTemplate && <div className="sm:col-span-2 lg:col-span-5"><div className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">Metrics</div><div className="flex flex-wrap gap-2">{selectedTemplate.definition.metrics.map((metric) => <label key={metric.metric_id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px]"><input type="checkbox" checked={metricIDs.includes(metric.metric_id)} onChange={(event) => setMetricIDs((current) => event.target.checked ? [...current, metric.metric_id] : current.filter((id) => id !== metric.metric_id))} />{metric.label || metric.metric_id}</label>)}</div></div>}
          <div className="sm:col-span-2 lg:col-span-5"><Button onClick={() => void runReport()} disabled={loading || !scopeID}><Play className="size-3.5" />{loading ? "Generating…" : "Generate report"}</Button></div>
        </CardContent>
      </Card>

      {!report ? <Card><CardContent className="flex min-h-44 flex-col items-center justify-center gap-2 text-center"><BarChart3 className="size-5 text-muted-foreground/60" /><p className="text-[13px] font-medium">No report generated</p><p className="max-w-sm text-xs text-muted-foreground text-pretty">Choose a scope and reporting window, then generate a report to see actual telemetry values.</p></CardContent></Card> : <>
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:grid-cols-4"><Summary label="Data points" value={reportRows.length} note={`${report.resolution || report.bucket || resolution} aggregates`} /><Summary label="Devices" value={distinctDevices} note="Included in the result" /><Summary label="Alerts" value={alertCount} note={report.alerts?.current_state || "No rollup returned"} tone={alertCount ? "warn" : "neutral"} /><Summary label="Window" value={days === "custom" ? `${fromDate} – ${toDate}` : `${days} days`} note="Selected reporting period" /></div>
        <Card>
          <CardHeader className="border-b border-border"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Telemetry results</CardTitle><CardDescription>{reportRows.length.toLocaleString()} metric rows in the selected scope.</CardDescription></div><Tabs value={activeTab} onValueChange={setActiveTab}><TabsList><TabsTrigger value="telemetry">Telemetry</TabsTrigger><TabsTrigger value="availability" disabled>Availability unavailable</TabsTrigger></TabsList></Tabs></div></CardHeader>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Metric</label><select aria-label="Report metric" className={`mt-1 w-[min(100%,360px)] ${selectClass}`} value={fieldID} onChange={(event) => setSelectedField(event.target.value)}>{fields.map(([id, aggregate]) => <option key={id} value={id}>{aggregate.label || id}</option>)}</select></div>{field && <div className="text-right text-[12px] text-muted-foreground">{field.label || fieldID}{field.unit ? ` · ${field.unit}` : ""}</div>}</div>
            {chartPoints.length > 1 ? <div className="h-[260px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartPoints} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}><CartesianGrid stroke="var(--row-divider)" vertical={false} /><XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} minTickGap={30} /><YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} width={42} /><Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(value: number) => [display(value, field?.unit), field?.label || fieldID]} /><Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">Not enough numeric samples for a trend chart.</div>}
            <div className="overflow-x-auto rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Bucket</TableHead><TableHead>Metric</TableHead><TableHead>Value</TableHead><TableHead>Range / delta</TableHead></TableRow></TableHeader><TableBody>{reportRows.map(({ item, id, aggregate }) => <TableRow key={`${item.device_id}-${item.source_id}-${item.bucket}-${id}`}><TableCell><div className="max-w-[220px] truncate text-[13px]">{item.device_name}</div><div className="font-mono text-[10px] text-muted-foreground">{item.source_id}</div></TableCell><TableCell className="whitespace-nowrap font-mono text-[10px]">{formatBucket(item.bucket)}</TableCell><TableCell>{aggregate.label || id}</TableCell><TableCell className="font-mono text-[11px]">{display(aggregateValue(aggregate), aggregate.unit)}</TableCell><TableCell className="font-mono text-[10px] text-muted-foreground">{aggregate.min != null || aggregate.max != null ? `${aggregate.min ?? "—"} – ${aggregate.max ?? "—"}` : aggregate.delta_samples ? `Δ ${aggregate.delta ?? 0}${aggregate.resets ? ` · ${aggregate.resets} resets` : ""}` : aggregate.state_seconds ? "State durations reported" : "—"}</TableCell></TableRow>)}{!reportRows.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-xs text-muted-foreground">No values returned for this metric.</TableCell></TableRow>}</TableBody></Table></div>
          </CardContent>
        </Card>
        <div className="rounded-lg border border-border bg-secondary/40 px-3.5 py-3 text-[12px] text-muted-foreground">Availability rollups, least-available devices, group comparisons, and scheduled reports are not shown because the current API does not return those datasets.</div>
      </>}
    </div>
  );
}
