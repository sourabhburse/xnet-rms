import React, { useMemo, useState } from "react";
import { Download, FileBarChart, Play, RefreshCw } from "lucide-react";

import { Device, DeviceGroup, TagItem, TelemetryAggregate, TelemetryReport, TelemetryReportPoint } from "../types";
import { api, formatApiError } from "../api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Scope = "device" | "group" | "tag";
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

function aggregateValue(field: TelemetryAggregate) {
  if (field.kind === "counter" && field.delta_samples) return field.delta;
  return field.average ?? field.last;
}

function display(value: unknown, unit = "") {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return `${Number.isInteger(value) ? value : value.toFixed(1)}${unit ? ` ${unit}` : ""}`;
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

function csvValue(value: unknown) {
  return `"${String(value ?? "").split('"').join('""')}"`;
}

export default function ReportsView({ devices, groups, tags, selectedOrg }: { devices: Device[]; groups: DeviceGroup[]; tags: TagItem[]; selectedOrg: string }) {
  const [scope, setScope] = useState<Scope>(devices.length ? "device" : "group");
  const [scopeID, setScopeID] = useState(devices[0]?.id || groups[0]?.id || tags[0]?.id || "");
  const [source, setSource] = useState("device_overview");
  const [days, setDays] = useState("30");
  const [bucket, setBucket] = useState<"hour" | "day">("hour");
  const [report, setReport] = useState<TelemetryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldID, setFieldID] = useState("");

  const visibleGroups = groups.filter((item) => !selectedOrg || item.organization_id === selectedOrg);
  const visibleTags = tags.filter((item) => !selectedOrg || item.organization_id === selectedOrg);
  const scopeItems = scope === "device" ? devices : scope === "group" ? visibleGroups : visibleTags;
  const sourceOptions = useMemo(() => {
    const values = new Set(["device_overview"]);
    if (scope === "device") {
      const device = devices.find((item) => item.id === scopeID);
      (device?.sources || []).forEach((item) => values.add(item.source_id));
    }
    return [...values].sort();
  }, [devices, scope, scopeID]);

  const fields = useMemo(() => {
    const values = new Map<string, TelemetryAggregate>();
    (report?.items || []).forEach((item) => Object.entries(item.fields || {}).forEach(([id, field]) => values.set(id, field)));
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [report]);
  const selectedField = fieldID || fields[0]?.[0] || "";
  const chartPoints = useMemo(() => {
    if (scope !== "device" || !selectedField) return [];
    return (report?.items || []).filter((item) => item.fields[selectedField]).map((item) => ({
      bucket: new Date(item.bucket).toLocaleString(),
      value: aggregateValue(item.fields[selectedField]),
    }));
  }, [report, scope, selectedField]);

  const runReport = async () => {
    if (!scopeID) { toast.warning("Choose a report scope first."); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ source, bucket, from: new Date(Date.now() - Number(days) * 86400000).toISOString(), to: new Date().toISOString() });
      if (selectedOrg) params.set("organization_id", selectedOrg);
      params.set(scope === "device" ? "device_id" : scope === "group" ? "group_id" : "tag_id", scopeID);
      const result = await api<TelemetryReport>(`reports/telemetry?${params}`);
      setReport(result);
      setFieldID("");
    } catch (err) { toast.error(formatApiError(err).message); } finally { setLoading(false); }
  };

  const exportCSV = () => {
    if (!report?.items.length) return;
    const headers = ["device", "source", "bucket", "metric", "value", "unit", "samples", "minimum", "maximum", "delta", "resets"];
    const rows = report.items.flatMap((item) => Object.entries(item.fields).map(([id, field]) => [item.device_name, item.source_id, item.bucket, field.label || id, aggregateValue(field), field.unit || "", field.count, field.min ?? "", field.max ?? "", field.delta ?? "", field.resets ?? ""]));
    const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `xnet-telemetry-${days}d.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><FileBarChart className="size-4" /></span><div><h1 className="font-display text-[20px] font-semibold">Telemetry reports</h1><p className="mt-1 text-[13px] text-muted-foreground">Query compact hourly or daily summaries across the retained telemetry window.</p></div></div><Button variant="outline" size="sm" onClick={runReport} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh report</Button></div>
    <Card><CardHeader className="border-b border-border"><CardTitle>Report scope</CardTitle><CardDescription>Raw snapshots are retained for at least 30 days; reports use rollups so large fleets remain queryable.</CardDescription></CardHeader><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scope</label><select className={selectClass} value={scope} onChange={(event) => { const value = event.target.value as Scope; setScope(value); setScopeID((value === "device" ? devices[0]?.id : value === "group" ? visibleGroups[0]?.id : visibleTags[0]?.id) || ""); }}><option value="device">Device</option><option value="group">Group</option><option value="tag">Tag</option></select></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target</label><select className={selectClass} value={scopeID} onChange={(event) => setScopeID(event.target.value)}><option value="">Select target</option>{scopeItems.map((item) => <option key={item.id} value={item.id}>{"serial_number" in item ? `${item.name || item.serial_number} · ${item.serial_number}` : item.name}</option>)}</select></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Source</label><select className={selectClass} value={source} onChange={(event) => setSource(event.target.value)}>{sourceOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Period</label><select className={selectClass} value={days} onChange={(event) => setDays(event.target.value)}><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resolution</label><select className={selectClass} value={bucket} onChange={(event) => setBucket(event.target.value as "hour" | "day")}><option value="hour">Hourly</option><option value="day">Daily</option></select></div><div className="sm:col-span-2 lg:col-span-5"><Button onClick={runReport} disabled={loading || !scopeID}><Play className="size-4" />{loading ? "Generating…" : "Generate report"}</Button></div></CardContent></Card>
    {!report ? <Card><CardContent className="flex min-h-40 flex-col items-center justify-center gap-1 p-6 text-center"><FileBarChart className="mb-1 size-6 text-muted-foreground/50" /><p className="text-[13px] font-medium">Choose a scope and generate a report</p><p className="text-xs text-muted-foreground">The report endpoint reads hourly rollups and never loads the full raw history into the browser.</p></CardContent></Card> : <>
      <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Rows</div><div className="mt-1 font-display text-xl font-semibold">{report.items.length}</div></CardContent></Card><Card><CardContent className="p-4"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Devices</div><div className="mt-1 font-display text-xl font-semibold">{new Set(report.items.map((item) => item.device_id)).size}</div></CardContent></Card><Card><CardContent className="flex items-center justify-between p-4"><div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Window</div><div className="mt-1 font-display text-xl font-semibold">{days} days</div></div><Button variant="outline" size="sm" onClick={exportCSV} disabled={!report.items.length}><Download className="size-3.5" />CSV</Button></CardContent></Card></div>
      {scope === "device" && <Card><CardHeader className="border-b border-border"><CardTitle>Metric trend</CardTitle><CardDescription>Hourly/daily aggregate for one selected device.</CardDescription></CardHeader><CardContent className="p-4"><select className="mb-4 h-9 w-full max-w-[320px] rounded-md border border-input bg-card px-3 text-[12px] text-foreground" value={selectedField} onChange={(event) => setFieldID(event.target.value)}><option value="">Select metric</option>{fields.map(([id, field]) => <option key={id} value={id}>{field.label || id}</option>)}</select>{chartPoints.length ? <div className="max-h-[240px] overflow-auto rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>Bucket</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{chartPoints.map((point) => <TableRow key={point.bucket}><TableCell className="whitespace-nowrap font-mono text-[11px]">{point.bucket}</TableCell><TableCell className="font-mono text-[11px]">{display(point.value, fields.find(([id]) => id === selectedField)?.[1].unit)}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-xs text-muted-foreground">No rollup points are available for this selection yet.</p>}</CardContent></Card>}
      <Card><CardHeader className="border-b border-border"><CardTitle>Report data</CardTitle><CardDescription>{report.bucket} summaries with counter deltas and gauge statistics.</CardDescription></CardHeader><CardContent className="p-0"><div className="max-h-[520px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Bucket</TableHead><TableHead>Metric</TableHead><TableHead>Value</TableHead><TableHead>Samples</TableHead><TableHead>Range / delta</TableHead></TableRow></TableHeader><TableBody>{report.items.flatMap((item: TelemetryReportPoint) => Object.entries(item.fields).map(([id, field]) => <TableRow key={`${item.device_id}-${item.source_id}-${item.bucket}-${id}`}><TableCell><div className="font-medium">{item.device_name}</div><div className="font-mono text-[10px] text-muted-foreground">{item.source_id}</div></TableCell><TableCell className="whitespace-nowrap font-mono text-[10.5px]">{new Date(item.bucket).toLocaleString()}</TableCell><TableCell>{field.label || id}</TableCell><TableCell className="font-mono text-[11px]">{display(aggregateValue(field), field.unit)}</TableCell><TableCell className="font-mono text-[11px]">{field.count}</TableCell><TableCell className="font-mono text-[10.5px] text-muted-foreground">{field.min != null || field.max != null ? `${field.min ?? "—"} – ${field.max ?? "—"}` : field.delta_samples ? `Δ ${field.delta ?? 0}` : "—"}{field.resets ? ` · ${field.resets} reset` : ""}</TableCell></TableRow>))}</TableBody></Table></div>{!report.items.length && <div className="p-8 text-center text-xs text-muted-foreground">No summaries are available for this scope and period.</div>}</CardContent></Card>
    </>}
  </div>;
}
