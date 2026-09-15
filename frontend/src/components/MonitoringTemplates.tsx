import React, { useEffect, useMemo, useState } from "react";
import { Check, Eye, LineChart, Pencil, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { CatalogMetric, Device, DeviceGroup, MonitoringBinding, MonitoringCatalog, MonitoringMetricSelection, MonitoringTemplate, Organization, TagItem, User } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";
type TargetType = "device" | "group" | "tag";
type GaugeOperator = "gt" | "gte" | "lt" | "lte" | "outside";
type GaugeDraft = { warningOp: GaugeOperator; warningValue: string; warningMinimum: string; warningMaximum: string; criticalOp: GaugeOperator; criticalValue: string; criticalMinimum: string; criticalMaximum: string };
const emptyGauge = (): GaugeDraft => ({ warningOp: "gt", warningValue: "", warningMinimum: "", warningMaximum: "", criticalOp: "gt", criticalValue: "", criticalMinimum: "", criticalMaximum: "" });
interface Props { currentUser: User; data: MonitoringTemplate[]; organizations: Organization[]; groups: DeviceGroup[]; tags: TagItem[]; selectedOrg: string; loading: boolean; onRefresh: () => void }

export default function MonitoringTemplates({ currentUser, data, organizations, groups, tags, selectedOrg, loading, onRefresh }: Props) {
  const isSuper = currentUser.role === "SUPER_ADMIN";
  const [catalog, setCatalog] = useState<MonitoringCatalog | null>(null);
  const [bindings, setBindings] = useState<MonitoringBinding[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MonitoringTemplate | null>(null);
  const [applyTemplate, setApplyTemplate] = useState<MonitoringTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetOrg, setTargetOrg] = useState(selectedOrg || currentUser.organization_id || "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [interval, setIntervalSeconds] = useState(60);
  const [selected, setSelected] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [gauges, setGauges] = useState<Record<string, GaugeDraft>>({});
  const [states, setStates] = useState<Record<string, { healthy: string; warning: string; critical: string }>>({});
  const [stale, setStale] = useState(false);
  const [staleSeverity, setStaleSeverity] = useState<"warning" | "critical">("warning");
  const [targetType, setTargetType] = useState<TargetType>("device");
  const [targetID, setTargetID] = useState("");
  const [bindingInterval, setBindingInterval] = useState(0);
  const [previewDevice, setPreviewDevice] = useState("");
  const [preview, setPreview] = useState<Array<{ metric_id: string; available: boolean; value?: { value?: unknown } }>>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [removeBindingTarget, setRemoveBindingTarget] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<MonitoringTemplate | null>(null);

  const suffix = targetOrg ? `?organization_id=${encodeURIComponent(targetOrg)}` : "";
  const refreshLocal = () => {
    api<MonitoringBinding[]>(`monitoring/bindings${suffix}`).then(setBindings).catch(() => setBindings([]));
    const params = new URLSearchParams({ page: "1", q: "" });
    if (targetOrg) params.set("organization_id", targetOrg);
    api<{ items: Device[] }>(`devices?${params}`).then(result => { setDevices(result.items || []); if (!previewDevice && result.items?.[0]) setPreviewDevice(result.items[0].id); }).catch(() => setDevices([]));
  };
  useEffect(() => { api<MonitoringCatalog>("monitoring/catalog").then(setCatalog).catch(err => toast.error(formatApiError(err).message)); }, []);
  useEffect(() => { if (selectedOrg) setTargetOrg(selectedOrg); }, [selectedOrg]);
  useEffect(refreshLocal, [targetOrg]);

  const visibleTemplates = data.filter(item => !targetOrg || item.organization_id === targetOrg);
  useEffect(() => {
    if (!visibleTemplates.some(item => item.id === selectedTemplateId)) setSelectedTemplateId(visibleTemplates[0]?.id || null);
  }, [visibleTemplates, selectedTemplateId]);
  const selectedTemplate = visibleTemplates.find(item => item.id === selectedTemplateId) || null;
  const visibleGroups = groups.filter(item => !targetOrg || item.organization_id === targetOrg);
  const visibleTags = tags.filter(item => !targetOrg || item.organization_id === targetOrg);
  const targets: Array<Device | DeviceGroup | TagItem> = targetType === "device" ? devices : targetType === "group" ? visibleGroups : visibleTags;
  const metricsByCategory = useMemo(() => {
    const grouped = new Map<string, CatalogMetric[]>();
    (catalog?.metrics || []).forEach(metric => grouped.set(metric.category, [...(grouped.get(metric.category) || []), metric]));
    return grouped;
  }, [catalog]);

  const openCreate = () => { setEditing(null); setName(""); setDescription(""); setIntervalSeconds(60); setSelected([]); setLabels({}); setGauges({}); setStates({}); setStale(false); setStaleSeverity("warning"); setPreview([]); setEditorOpen(true); };
  const openEdit = (item: MonitoringTemplate) => {
    const nextGauges: Record<string, GaugeDraft> = {}, nextStates: Record<string, { healthy: string; warning: string; critical: string }> = {}, nextLabels: Record<string, string> = {};
    item.definition.metrics.forEach(metric => {
      nextLabels[metric.metric_id] = metric.label || "";
      if (metric.threshold?.states) {
        nextStates[metric.metric_id] = { healthy: "", warning: "", critical: "" };
        Object.entries(metric.threshold.states).forEach(([value, severity]) => { nextStates[metric.metric_id][severity] = [nextStates[metric.metric_id][severity], value].filter(Boolean).join(", "); });
      } else nextGauges[metric.metric_id] = { warningOp: (metric.threshold?.warning?.operator as GaugeOperator) || "gt", warningValue: metric.threshold?.warning?.value?.toString() || "", warningMinimum: metric.threshold?.warning?.minimum?.toString() || "", warningMaximum: metric.threshold?.warning?.maximum?.toString() || "", criticalOp: (metric.threshold?.critical?.operator as GaugeOperator) || "gt", criticalValue: metric.threshold?.critical?.value?.toString() || "", criticalMinimum: metric.threshold?.critical?.minimum?.toString() || "", criticalMaximum: metric.threshold?.critical?.maximum?.toString() || "" };
    });
    setEditing(item); setName(item.name); setDescription(item.description); setIntervalSeconds(item.definition.interval_seconds); setSelected(item.definition.metrics.map(metric => metric.metric_id)); setLabels(nextLabels); setGauges(nextGauges); setStates(nextStates); setStale(item.definition.stale.enabled); setStaleSeverity(item.definition.stale.severity || "warning"); setPreview([]); setEditorOpen(true);
  };
  const definitionMetrics = (): MonitoringMetricSelection[] => selected.map(id => {
    const catalogMetric = catalog!.metrics.find(metric => metric.id === id)!;
    const item: MonitoringMetricSelection = { metric_id: id };
    if (labels[id]?.trim()) item.label = labels[id].trim();
    if (catalogMetric.field.kind === "gauge") {
      const draft = gauges[id] || emptyGauge();
      const warning = draft.warningOp === "outside" ? (draft.warningMinimum === "" || draft.warningMaximum === "" ? undefined : { operator: draft.warningOp, minimum: Number(draft.warningMinimum), maximum: Number(draft.warningMaximum) }) : (draft.warningValue === "" ? undefined : { operator: draft.warningOp, value: Number(draft.warningValue) });
      const critical = draft.criticalOp === "outside" ? (draft.criticalMinimum === "" || draft.criticalMaximum === "" ? undefined : { operator: draft.criticalOp, minimum: Number(draft.criticalMinimum), maximum: Number(draft.criticalMaximum) }) : (draft.criticalValue === "" ? undefined : { operator: draft.criticalOp, value: Number(draft.criticalValue) });
      if (warning || critical) item.threshold = { warning, critical };
    } else if (catalogMetric.field.kind === "state" && states[id]) {
      const map: Record<string, "healthy" | "warning" | "critical"> = {};
      (["healthy", "warning", "critical"] as const).forEach(severity => states[id][severity].split(",").map(value => value.trim()).filter(Boolean).forEach(value => { map[value] = severity; }));
      if (Object.keys(map).length) item.threshold = { states: map };
    }
    return item;
  });
  const save = async () => {
    if (!catalog || !name.trim() || !selected.length || (isSuper && !targetOrg)) { toast.warning("Choose a customer, name, and at least one approved metric."); return; }
    if (interval < 60 || interval > 300) { toast.warning("Collection interval must be 60–300 seconds."); return; }
    const invalidRange = selected.some(id => { const draft = gauges[id]; if (!draft) return false; return (draft.warningOp === "outside" && ((draft.warningMinimum === "") !== (draft.warningMaximum === "") || (draft.warningMinimum !== "" && Number(draft.warningMinimum) >= Number(draft.warningMaximum)))) || (draft.criticalOp === "outside" && ((draft.criticalMinimum === "") !== (draft.criticalMaximum === "") || (draft.criticalMinimum !== "" && Number(draft.criticalMinimum) >= Number(draft.criticalMaximum)))); });
    if (invalidRange) { toast.warning("Outside-range thresholds need a minimum lower than the maximum."); return; }
    setBusy(true);
    try {
      const payload = { organization_id: isSuper ? targetOrg : undefined, name: name.trim(), description: description.trim(), definition: { catalog_version: catalog.version, interval_seconds: interval, metrics: definitionMetrics(), stale: stale ? { enabled: true, severity: staleSeverity, missed_intervals: 2 } : { enabled: false } } };
      await api(`monitoring/templates${editing ? `/${editing.id}` : ""}`, editing ? "PATCH" : "POST", payload);
      toast.success(editing ? "New template version published" : "Monitoring template created"); setEditorOpen(false); onRefresh(); refreshLocal();
    } catch (err) { toast.error(formatApiError(err).message); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!applyTemplate || !targetID) return;
    setBusy(true);
    try { await api("monitoring/bindings", "POST", { template_id: applyTemplate.id, target_type: targetType, target_id: targetID, interval_seconds: bindingInterval || undefined }); toast.success("Dynamic monitoring binding saved"); setApplyTemplate(null); refreshLocal(); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setBusy(false); }
  };
  const removeBinding = async () => { if (!removeBindingTarget) return; try { await api(`monitoring/bindings/${removeBindingTarget}`, "DELETE"); toast.success("Binding removed; affected alerts will resolve as unassigned"); setRemoveBindingTarget(null); refreshLocal(); } catch (err) { toast.error(formatApiError(err).message); } };
  const archive = async () => { if (!archiveTarget) return; try { await api(`monitoring/templates/${archiveTarget.id}`, "DELETE"); toast.success("Template archived"); setArchiveTarget(null); onRefresh(); refreshLocal(); } catch (err) { toast.error(formatApiError(err).message); } };
  const runPreview = async () => {
    if (!previewDevice || !selected.length) { toast.warning("Choose a preview device and metrics."); return; }
    setBusy(true);
    try {
      type PreviewResult = { id: string; status: "pending" | "complete" | "failed"; items: typeof preview };
      let result = await api<PreviewResult>("monitoring/previews", "POST", { device_id: previewDevice, metric_ids: selected });
      for (let attempt = 0; result.status === "pending" && attempt < 65; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        result = await api<PreviewResult>(`monitoring/previews/${result.id}`);
      }
      setPreview(result.items || []);
      if (result.status !== "complete") toast.warning("Router preview timed out; unsupported values remain absent.");
    }
    catch (err) { toast.error(formatApiError(err).message); } finally { setBusy(false); }
  };

  return <div className="mx-auto flex max-w-[1300px] flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><LineChart className="size-4" /></span><div><h1 className="font-display text-[20px] font-semibold">Monitoring templates</h1><p className="mt-1 text-[13px] text-muted-foreground">Compose approved metrics, health rules, and dynamic device/group/tag assignments. Raw router calls are platform-admin only.</p></div></div><div className="flex gap-2">{isSuper && <select className={selectClass} value={targetOrg} onChange={event => setTargetOrg(event.target.value)}><option value="">Select customer</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select>}<Button variant="outline" size="sm" onClick={() => { onRefresh(); refreshLocal(); }} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button><Button size="sm" onClick={openCreate}><Plus className="size-4" />Create</Button></div></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]"><Card className="min-w-0"><CardHeader className="border-b border-border"><CardTitle>Templates</CardTitle><CardDescription>Every edit publishes an immutable version and restarts threshold state cleanly.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Version</TableHead><TableHead>Metrics</TableHead><TableHead>Interval</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{visibleTemplates.map(item => <TableRow key={item.id} data-state={selectedTemplateId === item.id ? "selected" : undefined} className="cursor-pointer" onClick={() => setSelectedTemplateId(item.id)}><TableCell><div className="font-medium">{item.name}</div><div className="text-[11px] text-muted-foreground">{item.description || "No description"}</div></TableCell><TableCell><Badge variant="accent">v{item.version}</Badge></TableCell><TableCell className="tabular-nums">{item.definition.metrics.length}</TableCell><TableCell className="font-mono text-[11px] tabular-nums">{item.definition.interval_seconds}s</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="outline" size="sm" onClick={event => { event.stopPropagation(); openEdit(item); }}><Pencil className="size-3.5" />Edit</Button><Button variant="outline" size="sm" onClick={event => { event.stopPropagation(); setApplyTemplate(item); setTargetID(""); }}><Send className="size-3.5" />Apply</Button><Button variant="ghost" size="icon" aria-label={`Archive ${item.name}`} onClick={event => { event.stopPropagation(); setArchiveTarget(item); }}><Trash2 className="size-4 text-destructive" /></Button></div></TableCell></TableRow>)}{!visibleTemplates.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-xs text-muted-foreground">{loading ? "Loading…" : "No monitoring templates in this customer scope."}</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card><TemplateDetail template={selectedTemplate} catalog={catalog} onEdit={openEdit} onApply={item => { setApplyTemplate(item); setTargetID(""); }} /></div>
    <Card><CardHeader className="border-b border-border"><CardTitle>Dynamic assignments</CardTitle><CardDescription>Membership changes are reconciled automatically; overlapping templates share one collector at the fastest interval.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Target</TableHead><TableHead>Override</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{bindings.map(binding => <TableRow key={binding.id}><TableCell>{binding.template_name} <Badge variant="secondary">v{binding.template_version}</Badge></TableCell><TableCell><span className="uppercase text-[10px] text-muted-foreground">{binding.target_type}</span> · <span className="font-mono text-[11px]">{binding.target_id}</span></TableCell><TableCell>{binding.interval_seconds ? `${binding.interval_seconds}s` : "Template default"}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" aria-label={`Remove ${binding.template_name} assignment`} onClick={() => setRemoveBindingTarget(binding.id)}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}{!bindings.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-xs text-muted-foreground">No bindings.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[900px]"><DialogHeader><DialogTitle>{editing ? "Publish template version" : "Create monitoring template"}</DialogTitle><DialogDescription>Only server-owned, typed, read-only catalog metrics can be selected. Missing router capabilities stay unavailable, never zero.</DialogDescription></DialogHeader><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Name</label><Input value={name} onChange={event => setName(event.target.value)} /></div><div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Interval</label><Input type="number" min={60} max={300} value={interval} onChange={event => setIntervalSeconds(Number(event.target.value))} /></div><div><label className="text-[11px] font-semibold uppercase text-muted-foreground">Preview device</label><select className={selectClass} value={previewDevice} onChange={event => setPreviewDevice(event.target.value)}><option value="">Select device</option>{devices.map(device => <option key={device.id} value={device.id}>{device.name || device.serial_number}</option>)}</select></div></div><Input value={description} placeholder="Customer-visible description" onChange={event => setDescription(event.target.value)} />
      {[...(catalog?.categories || [])].map(category => <div key={category} className="rounded-lg border border-border"><div className="border-b border-border bg-secondary/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide">{category}</div><div className="divide-y divide-border">{(metricsByCategory.get(category) || []).map(metric => { const checked = selected.includes(metric.id), gauge = gauges[metric.id] || emptyGauge(), state = states[metric.id] || { healthy: "", warning: "", critical: "" }; return <div key={metric.id} className="p-3"><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-4 accent-primary" checked={checked} onChange={event => setSelected(current => event.target.checked ? [...current, metric.id] : current.filter(item => item !== metric.id))} /><span><span className="text-[13px] font-medium">{metric.field.label}</span><span className="ml-2 font-mono text-[10px] text-muted-foreground">{metric.field.kind}</span><span className="block text-[11px] text-muted-foreground">{metric.description}</span></span></label>{checked && <div className="ml-6 mt-2 grid gap-2 sm:grid-cols-3"><Input placeholder="Custom display label (optional)" value={labels[metric.id] || ""} onChange={event => setLabels({ ...labels, [metric.id]: event.target.value })} />{metric.field.kind === "gauge" && <GaugeThresholdEditor value={gauge} onChange={value => setGauges({ ...gauges, [metric.id]: value })} />}{metric.field.kind === "state" && <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3"><Input placeholder="Healthy values, comma separated" value={state.healthy} onChange={event => setStates({ ...states, [metric.id]: { ...state, healthy: event.target.value } })} /><Input placeholder="Warning values" value={state.warning} onChange={event => setStates({ ...states, [metric.id]: { ...state, warning: event.target.value } })} /><Input placeholder="Critical values" value={state.critical} onChange={event => setStates({ ...states, [metric.id]: { ...state, critical: event.target.value } })} /></div>}</div>}</div>; })}</div></div>)}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"><label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={stale} onChange={event => setStale(event.target.checked)} />Alert after two missed intervals</label>{stale && <select className={selectClass + " max-w-40"} value={staleSeverity} onChange={event => setStaleSeverity(event.target.value as "warning" | "critical")}><option value="warning">Warning</option><option value="critical">Critical</option></select>}<Button variant="outline" size="sm" onClick={runPreview} disabled={busy}><Eye className="size-3.5" />Preview approved sample</Button></div>{preview.length > 0 && <div className="rounded-lg border border-border p-3"><div className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">Router compatibility preview</div><div className="grid gap-1 sm:grid-cols-2">{preview.map(item => <div key={item.metric_id} className="flex justify-between text-[11px]"><span>{item.metric_id}</span><Badge variant={item.available ? "ok" : "secondary"}>{item.available ? String(item.value?.value ?? "Available") : "Unsupported / absent"}</Badge></div>)}</div></div>}</div><DialogFooter><Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}><Check className="size-4" />{busy ? "Saving…" : editing ? "Publish version" : "Create template"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!applyTemplate} onOpenChange={open => !open && setApplyTemplate(null)}><DialogContent><DialogHeader><DialogTitle>Apply monitoring template</DialogTitle><DialogDescription>The binding remains active as device group or tag membership changes.</DialogDescription></DialogHeader><div className="space-y-3"><select className={selectClass} value={targetType} onChange={event => { setTargetType(event.target.value as TargetType); setTargetID(""); }}><option value="device">Device</option><option value="group">Group</option><option value="tag">Tag</option></select><select className={selectClass} value={targetID} onChange={event => setTargetID(event.target.value)}><option value="">Select target</option>{targets.map(item => <option key={item.id} value={item.id}>{"serial_number" in item ? item.name || item.serial_number : String(item.name)}</option>)}</select><div><label className="text-[11px] text-muted-foreground">Optional interval override (60–300 seconds)</label><Input type="number" min={0} max={300} value={bindingInterval} onChange={event => setBindingInterval(Number(event.target.value))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setApplyTemplate(null)}>Cancel</Button><Button onClick={apply} disabled={busy || !targetID}><Send className="size-4" />Apply</Button></DialogFooter></DialogContent></Dialog>
    <ConfirmDialog open={!!archiveTarget} onOpenChange={open => !open && setArchiveTarget(null)} title="Archive monitoring template?" description="This removes the template from the active catalog. Existing historical telemetry remains unchanged." confirmLabel="Archive template" onConfirm={archive} />
    <ConfirmDialog open={!!removeBindingTarget} onOpenChange={open => !open && setRemoveBindingTarget(null)} title="Remove dynamic assignment?" description="Devices matching this group or tag will stop receiving this monitoring template." confirmLabel="Remove assignment" onConfirm={removeBinding} />
  </div>;
}

function formatThresholdCondition(condition: { operator: string; value?: number; minimum?: number; maximum?: number }) {
  const labels: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", outside: "outside" };
  if (condition.operator === "outside") return `${condition.minimum ?? "?"}–${condition.maximum ?? "?"}`;
  return `${labels[condition.operator] || condition.operator} ${condition.value ?? "?"}`;
}

function thresholdSummary(metric: MonitoringMetricSelection) {
  const threshold = metric.threshold;
  if (!threshold) return "No threshold configured";
  if (threshold.states) {
    const states = Object.entries(threshold.states).map(([value, severity]) => `${value}: ${severity}`).join(" · ");
    return states || "No state values configured";
  }
  const parts = [
    threshold.warning && `Warn ${formatThresholdCondition(threshold.warning)}`,
    threshold.critical && `Critical ${formatThresholdCondition(threshold.critical)}`,
  ].filter(Boolean);
  return parts.join(" · ") || "No threshold configured";
}

function TemplateDetail({ template, catalog, onEdit, onApply }: { template: MonitoringTemplate | null; catalog: MonitoringCatalog | null; onEdit: (template: MonitoringTemplate) => void; onApply: (template: MonitoringTemplate) => void }) {
  const metrics = catalog?.metrics || [];
  const metricFor = (id: string) => metrics.find(metric => metric.id === id);
  return <Card className="h-fit xl:sticky xl:top-4"><CardHeader className="border-b border-border"><div className="flex items-start justify-between gap-3"><div><CardDescription>Selected template</CardDescription><CardTitle className="mt-1 text-[17px]">{template?.name || "Choose a template"}</CardTitle></div>{template && <Badge variant="accent">v{template.version}</Badge>}</div></CardHeader><CardContent className="space-y-4 p-5">{template ? <><p className="text-[13px] leading-5 text-muted-foreground text-pretty">{template.description || "No customer-facing description."}</p><div className="grid grid-cols-2 gap-2"><div className="rounded-lg border border-border bg-secondary/35 p-3"><div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Interval</div><div className="mt-1 font-display text-[18px] font-semibold tabular-nums">{template.definition.interval_seconds}s</div></div><div className="rounded-lg border border-border bg-secondary/35 p-3"><div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Metrics</div><div className="mt-1 font-display text-[18px] font-semibold tabular-nums">{template.definition.metrics.length}</div></div></div><div className={template.definition.stale.enabled ? "rounded-lg border border-warn-border bg-warn-bg p-3 text-[12px] text-warn" : "rounded-lg border border-border bg-secondary/35 p-3 text-[12px] text-muted-foreground"}>{template.definition.stale.enabled ? `Stale alert after ${template.definition.stale.missed_intervals || 2} missed intervals · ${template.definition.stale.severity || "warning"}` : "Stale alerting is not enabled for this template."}</div><div><div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Threshold rules</div><div className="divide-y divide-border rounded-lg border border-border">{template.definition.metrics.map(selection => { const metric = metricFor(selection.metric_id); return <div key={selection.metric_id} className="p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-[12px] font-medium">{selection.label || metric?.field.label || selection.metric_id}</div><div className="font-mono text-[10px] text-muted-foreground">{selection.metric_id} · {metric?.field.kind || "catalog metric"}</div></div><Badge variant="secondary" className="font-normal">{metric?.category || "Metric"}</Badge></div><div className="mt-2 text-[11px] text-muted-foreground">{thresholdSummary(selection)}</div></div>; })}{!template.definition.metrics.length && <div className="p-3 text-[12px] text-muted-foreground">No metrics selected.</div>}</div></div><div className="flex gap-2"><Button variant="outline" className="flex-1" onClick={() => onEdit(template)}><Pencil className="size-3.5" />Edit</Button><Button className="flex-1" onClick={() => onApply(template)}><Send className="size-3.5" />Apply</Button></div></> : <div className="py-8 text-center text-[12px] text-muted-foreground">Select a template from the list to inspect its read-only rules and metrics.</div>}</CardContent></Card>;
}

function GaugeThresholdEditor({ value, onChange }: { value: GaugeDraft; onChange: (value: GaugeDraft) => void }) {
  const row = (severity: "warning" | "critical") => {
    const opKey = `${severity}Op` as const;
    const valueKey = `${severity}Value` as const;
    const minimumKey = `${severity}Minimum` as const;
    const maximumKey = `${severity}Maximum` as const;
    const title = severity === "warning" ? "Warn" : "Critical";
    return <div className="flex gap-1"><select className={selectClass} value={value[opKey]} onChange={event => onChange({ ...value, [opKey]: event.target.value as GaugeOperator })}><option value="gt">{title} &gt;</option><option value="gte">{title} ≥</option><option value="lt">{title} &lt;</option><option value="lte">{title} ≤</option><option value="outside">{title} outside</option></select>{value[opKey] === "outside" ? <><Input type="number" aria-label={`${title} minimum`} placeholder="Min" value={value[minimumKey]} onChange={event => onChange({ ...value, [minimumKey]: event.target.value })} /><Input type="number" aria-label={`${title} maximum`} placeholder="Max" value={value[maximumKey]} onChange={event => onChange({ ...value, [maximumKey]: event.target.value })} /></> : <Input type="number" placeholder="Optional" value={value[valueKey]} onChange={event => onChange({ ...value, [valueKey]: event.target.value })} />}</div>;
  };
  return <>{row("warning")}{row("critical")}</>;
}
