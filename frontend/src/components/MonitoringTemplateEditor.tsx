import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Eye, Info, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { CatalogMetric, Device, MonitoringCatalog, MonitoringMetricSelection, MonitoringTemplate, Organization, User } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";
const textareaClass = "min-h-24 w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25";
type Step = 0 | 1 | 2;
type GaugeOperator = "gt" | "gte" | "lt" | "lte" | "outside";
type Severity = "healthy" | "warning" | "critical";
type StateValues = { healthy: string; warning: string; critical: string };
type GaugeDraft = {
  warningOp: GaugeOperator;
  warningValue: string;
  warningMinimum: string;
  warningMaximum: string;
  criticalOp: GaugeOperator;
  criticalValue: string;
  criticalMinimum: string;
  criticalMaximum: string;
};
type PreviewItem = { metric_id: string; available: boolean; value?: { value?: unknown }; error?: string };

const emptyGauge = (): GaugeDraft => ({ warningOp: "gt", warningValue: "", warningMinimum: "", warningMaximum: "", criticalOp: "gt", criticalValue: "", criticalMinimum: "", criticalMaximum: "" });
const emptyStates = (): StateValues => ({ healthy: "", warning: "", critical: "" });

interface Props {
  currentUser: User;
  organizations: Organization[];
  selectedOrg: string;
  templateId: string | null;
  data: MonitoringTemplate[];
  loading: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

export default function MonitoringTemplateEditor({ currentUser, organizations, selectedOrg, templateId, data, loading, onCancel, onSaved }: Props) {
  const isSuper = currentUser.role === "SUPER_ADMIN";
  const template = templateId ? data.find(item => item.id === templateId) || null : null;
  const [catalog, setCatalog] = useState<MonitoringCatalog | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [step, setStep] = useState<Step>(0);
  const [targetOrg, setTargetOrg] = useState(selectedOrg || currentUser.organization_id || "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [interval, setIntervalSeconds] = useState(60);
  const [selected, setSelected] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [gauges, setGauges] = useState<Record<string, GaugeDraft>>({});
  const [states, setStates] = useState<Record<string, StateValues>>({});
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});
  const [stale, setStale] = useState(false);
  const [staleSeverity, setStaleSeverity] = useState<"warning" | "critical">("warning");
  const [previewDevice, setPreviewDevice] = useState("");
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [metricSearch, setMetricSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<MonitoringCatalog>("monitoring/catalog")
      .then(result => setCatalog(result))
      .catch(err => toast.error(formatApiError(err).message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: "1", q: "" });
    if (targetOrg) params.set("organization_id", targetOrg);
    api<{ items: Device[] }>(`devices?${params}`)
      .then(result => {
        if (cancelled) return;
        const items = result.items || [];
        setDevices(items);
        setPreviewDevice(current => current || items[0]?.id || "");
      })
      .catch(() => { if (!cancelled) setDevices([]); });
    return () => { cancelled = true; };
  }, [targetOrg]);

  useEffect(() => {
    if (!templateId) {
      setStep(0);
      setTargetOrg(selectedOrg || currentUser.organization_id || "");
      setName("");
      setDescription("");
      setIntervalSeconds(60);
      setSelected([]);
      setLabels({});
      setGauges({});
      setStates({});
      setExpandedRules({});
      setStale(false);
      setStaleSeverity("warning");
      setPreview([]);
      return;
    }
    if (!template) return;

    const nextGauges: Record<string, GaugeDraft> = {};
    const nextStates: Record<string, StateValues> = {};
    const nextLabels: Record<string, string> = {};
    const nextExpanded: Record<string, boolean> = {};
    template.definition.metrics.forEach(metric => {
      nextLabels[metric.metric_id] = metric.label || "";
      if (metric.threshold?.states) {
        const state = emptyStates();
        Object.entries(metric.threshold.states).forEach(([value, severity]) => {
          state[severity] = [state[severity], value].filter(Boolean).join(", ");
        });
        nextStates[metric.metric_id] = state;
        nextExpanded[metric.metric_id] = true;
      } else {
        nextGauges[metric.metric_id] = {
          warningOp: metric.threshold?.warning?.operator || "gt",
          warningValue: metric.threshold?.warning?.value?.toString() || "",
          warningMinimum: metric.threshold?.warning?.minimum?.toString() || "",
          warningMaximum: metric.threshold?.warning?.maximum?.toString() || "",
          criticalOp: metric.threshold?.critical?.operator || "gt",
          criticalValue: metric.threshold?.critical?.value?.toString() || "",
          criticalMinimum: metric.threshold?.critical?.minimum?.toString() || "",
          criticalMaximum: metric.threshold?.critical?.maximum?.toString() || "",
        };
        nextExpanded[metric.metric_id] = Boolean(metric.threshold?.warning || metric.threshold?.critical);
      }
    });
    setStep(0);
    setTargetOrg(template.organization_id || selectedOrg || currentUser.organization_id || "");
    setName(template.name);
    setDescription(template.description || "");
    setIntervalSeconds(template.definition.interval_seconds);
    setSelected(template.definition.metrics.map(metric => metric.metric_id));
    setLabels(nextLabels);
    setGauges(nextGauges);
    setStates(nextStates);
    setExpandedRules(nextExpanded);
    setStale(template.definition.stale.enabled);
    setStaleSeverity(template.definition.stale.severity || "warning");
    setPreview([]);
  }, [templateId, template?.id, currentUser.organization_id]);

  useEffect(() => {
    if (!templateId && selectedOrg) setTargetOrg(selectedOrg);
  }, [selectedOrg, templateId]);

  const categories = catalog?.categories || [];
  const metrics = catalog?.metrics || [];
  const metricsByCategory = useMemo(() => {
    const grouped = new Map<string, CatalogMetric[]>();
    metrics.forEach(metric => grouped.set(metric.category, [...(grouped.get(metric.category) || []), metric]));
    return grouped;
  }, [metrics]);

  useEffect(() => {
    if (!activeCategory || !categories.includes(activeCategory)) setActiveCategory(categories[0] || "");
  }, [categories, activeCategory]);

  const metricFor = (id: string) => metrics.find(metric => metric.id === id);
  const selectedMetrics = selected.map(metricFor).filter((metric): metric is CatalogMetric => Boolean(metric));
  const selectedSet = new Set(selected);
  const search = metricSearch.trim().toLowerCase();
  const filteredMetrics = (metricsByCategory.get(activeCategory) || []).filter(metric => {
    if (selectedOnly && !selectedSet.has(metric.id)) return false;
    if (!search) return true;
    return [metric.id, metric.field.label, metric.description, metric.category].some(value => value.toLowerCase().includes(search));
  });
  const rulesCount = selected.filter(id => {
    const metric = metricFor(id);
    return metric?.field.kind === "gauge" ? hasGaugeRules(gauges[id]) : metric?.field.kind === "state" ? hasStateRules(states[id]) : false;
  }).length;
  const organization = organizations.find(item => item.id === targetOrg);
  const customerLabel = organization?.name || (isSuper ? "Select customer" : "Current customer");
  const draftVersion = template ? template.version + 1 : 1;

  const setMetricSelected = (id: string, checked: boolean) => {
    setSelected(current => checked ? (current.includes(id) ? current : [...current, id]) : current.filter(item => item !== id));
    setPreview([]);
  };

  const removeMetric = (id: string) => setMetricSelected(id, false);

  const validateBasics = () => {
    if (!name.trim() || (isSuper && !targetOrg)) {
      toast.warning("Choose a customer and enter a template name.");
      return false;
    }
    if (interval < 60 || interval > 300) {
      toast.warning("Collection interval must be 60–300 seconds.");
      return false;
    }
    return true;
  };

  const validateMetrics = () => {
    if (!selected.length) {
      toast.warning("Select at least one approved catalog metric.");
      return false;
    }
    return true;
  };

  const nextStep = () => {
    if (step === 0 && validateBasics()) setStep(1);
    else if (step === 1 && validateMetrics()) setStep(2);
  };

  const definitionMetrics = (): MonitoringMetricSelection[] => selected.map(id => {
    const catalogMetric = metrics.find(metric => metric.id === id);
    const item: MonitoringMetricSelection = { metric_id: id };
    if (!catalogMetric) return item;
    if (labels[id]?.trim()) item.label = labels[id].trim();
    if (catalogMetric.field.kind === "gauge") {
      const draft = gauges[id] || emptyGauge();
      const warning = draft.warningOp === "outside"
        ? (draft.warningMinimum === "" || draft.warningMaximum === "" ? undefined : { operator: draft.warningOp, minimum: Number(draft.warningMinimum), maximum: Number(draft.warningMaximum) })
        : (draft.warningValue === "" ? undefined : { operator: draft.warningOp, value: Number(draft.warningValue) });
      const critical = draft.criticalOp === "outside"
        ? (draft.criticalMinimum === "" || draft.criticalMaximum === "" ? undefined : { operator: draft.criticalOp, minimum: Number(draft.criticalMinimum), maximum: Number(draft.criticalMaximum) })
        : (draft.criticalValue === "" ? undefined : { operator: draft.criticalOp, value: Number(draft.criticalValue) });
      if (warning || critical) item.threshold = { warning, critical };
    } else if (catalogMetric.field.kind === "state" && states[id]) {
      const map: Record<string, Severity> = {};
      (['healthy', 'warning', 'critical'] as const).forEach(severity => {
        states[id][severity].split(",").map(value => value.trim()).filter(Boolean).forEach(value => { map[value] = severity; });
      });
      if (Object.keys(map).length) item.threshold = { states: map };
    }
    return item;
  });

  const save = async () => {
    if (!catalog || !validateBasics() || !validateMetrics()) return;
    const invalidRange = selected.some(id => {
      const draft = gauges[id];
      if (!draft) return false;
      return (draft.warningOp === "outside" && ((draft.warningMinimum === "") !== (draft.warningMaximum === "") || (draft.warningMinimum !== "" && Number(draft.warningMinimum) >= Number(draft.warningMaximum))))
        || (draft.criticalOp === "outside" && ((draft.criticalMinimum === "") !== (draft.criticalMaximum === "") || (draft.criticalMinimum !== "" && Number(draft.criticalMinimum) >= Number(draft.criticalMaximum))));
    });
    if (invalidRange) {
      toast.warning("Outside-range thresholds need a minimum lower than the maximum.");
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        organization_id: isSuper ? targetOrg : undefined,
        name: name.trim(),
        description: description.trim(),
        definition: {
          catalog_version: catalog.version,
          interval_seconds: interval,
          metrics: definitionMetrics(),
          stale: stale ? { enabled: true, severity: staleSeverity, missed_intervals: 2 } : { enabled: false },
        },
      };
      await api(`monitoring/templates${template ? `/${template.id}` : ""}`, template ? "PATCH" : "POST", payload);
      toast.success(template ? "New template version published" : "Monitoring template created");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!previewDevice || !selected.length) {
      toast.warning("Choose a preview device and metrics.");
      return;
    }
    setBusy(true);
    try {
      type PreviewResult = { id: string; status: "pending" | "complete" | "failed"; items: PreviewItem[] };
      let result = await api<PreviewResult>("monitoring/previews", "POST", { device_id: previewDevice, metric_ids: selected });
      for (let attempt = 0; result.status === "pending" && attempt < 65; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
        result = await api<PreviewResult>(`monitoring/previews/${result.id}`);
      }
      setPreview(result.items || []);
      if (result.status !== "complete") toast.warning("Router preview timed out; unsupported values remain absent.");
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  if (templateId && !template && loading) {
    return <div className="mx-auto flex min-h-80 max-w-[1380px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">Loading template…</div>;
  }
  if (templateId && !template) {
    return <div className="mx-auto flex max-w-[1380px] flex-col items-start gap-4 rounded-xl border border-down-border bg-down-bg p-6 text-sm text-down"><p>This monitoring template could not be found in the current customer scope.</p><Button variant="outline" onClick={onCancel}><ArrowLeft className="size-3.5" />Back to templates</Button></div>;
  }

  const steps: Array<{ label: string; summary: string }> = [
    { label: "Basics", summary: `${customerLabel} · ${interval || 0} s` },
    { label: "Metrics", summary: `${selected.length} of ${metrics.length} selected` },
    { label: "Thresholds & alerting", summary: `${rulesCount} of ${selected.length} metrics have rules` },
  ];

  return <div className="mx-auto flex max-w-[1380px] flex-col gap-5" aria-busy={busy}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <button type="button" className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground" onClick={onCancel}><ArrowLeft className="size-3.5" />Monitoring templates</button>
        <h1 className="font-display text-[24px] font-semibold tracking-[-0.02em]">{template ? "Publish new version" : "New monitoring template"}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{customerLabel} · catalog v{catalog?.version ?? "—"} · {template ? `draft v${draftVersion}` : "draft"}</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-ok" />Changes stay in draft until you {template ? "publish the new version" : "create the template"}.</div>
    </div>

    <nav aria-label="Template setup steps" className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-3">
      {steps.map((item, index) => <button key={item.label} type="button" onClick={() => setStep(index as Step)} className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${step === index ? "bg-accent text-accent-foreground" : "hover:bg-secondary"}`}>
        <span className={`grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${step === index ? "border-accent-foreground/30 bg-accent-foreground/10" : index < step ? "border-ok-border bg-ok-bg text-ok" : "border-border text-muted-foreground"}`}>{index < step ? <Check className="size-3.5" /> : index + 1}</span>
        <span className="min-w-0"><span className="block truncate text-[12px] font-semibold">{item.label}</span><span className="block truncate text-[11px] text-muted-foreground">{item.summary}</span></span>
      </button>)}
    </nav>

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_312px]">
      <main className="min-w-0 space-y-5">
        {step === 0 && <BasicsStep isSuper={isSuper} organizations={organizations} targetOrg={targetOrg} onTargetOrgChange={setTargetOrg} name={name} onNameChange={setName} description={description} onDescriptionChange={setDescription} interval={interval} onIntervalChange={setIntervalSeconds} />}
        {step === 1 && <MetricsStep catalog={catalog} categories={categories} activeCategory={activeCategory} onCategoryChange={setActiveCategory} metrics={filteredMetrics} selected={selectedSet} labels={labels} onLabelChange={(id, value) => setLabels(current => ({ ...current, [id]: value }))} selectedOnly={selectedOnly} onSelectedOnlyChange={setSelectedOnly} search={metricSearch} onSearchChange={setMetricSearch} onMetricSelected={setMetricSelected} selectedCount={selected.length} />}
        {step === 2 && <ThresholdsStep catalog={catalog} selectedMetrics={selectedMetrics} gauges={gauges} states={states} expandedRules={expandedRules} setGauges={setGauges} setStates={setStates} setExpandedRules={setExpandedRules} removeMetric={removeMetric} stale={stale} setStale={setStale} staleSeverity={staleSeverity} setStaleSeverity={setStaleSeverity} devices={devices} previewDevice={previewDevice} setPreviewDevice={setPreviewDevice} preview={preview} runPreview={runPreview} busy={busy} />}
      </main>
      <DraftRail name={name} description={description} customerLabel={customerLabel} interval={interval} catalogVersion={catalog?.version} draftVersion={draftVersion} selectedMetrics={selectedMetrics} removeMetric={removeMetric} hasCustomer={Boolean(targetOrg)} hasName={Boolean(name.trim())} hasInterval={interval >= 60 && interval <= 300} hasMetrics={selected.length > 0} />
    </div>

    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <Button variant="outline" onClick={() => step === 0 ? onCancel() : setStep((step - 1) as Step)} disabled={busy}><ArrowLeft className="size-3.5" />{step === 0 ? "Cancel" : "Back"}</Button>
      <div className="order-3 w-full text-center text-[11px] text-muted-foreground sm:order-none sm:w-auto">Publishes as v{draftVersion} · {rulesCount} of {selected.length} metrics have rules</div>
      <Button onClick={step === 2 ? save : nextStep} disabled={busy || !catalog}>{busy ? "Working…" : step === 2 ? (template ? "Publish version" : "Create template") : <><span>Continue</span><ArrowRight className="size-3.5" /></>}</Button>
    </footer>
  </div>;
}

function BasicsStep({ isSuper, organizations, targetOrg, onTargetOrgChange, name, onNameChange, description, onDescriptionChange, interval, onIntervalChange }: { isSuper: boolean; organizations: Organization[]; targetOrg: string; onTargetOrgChange: (value: string) => void; name: string; onNameChange: (value: string) => void; description: string; onDescriptionChange: (value: string) => void; interval: number; onIntervalChange: (value: number) => void }) {
  const presets = [60, 120, 300];
  const isPreset = presets.includes(interval);
  return <Card><CardHeader className="border-b border-border"><CardTitle>Template identity</CardTitle><CardDescription>Give the monitoring policy a clear customer-facing name and collection cadence.</CardDescription></CardHeader><CardContent className="space-y-5 p-5">
    <div className="grid gap-5 md:grid-cols-2">
      <div><label htmlFor="template-name" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Template name</label><Input id="template-name" autoFocus value={name} maxLength={128} placeholder="e.g. Warehouse gateway health" onChange={event => onNameChange(event.target.value)} /><p className="mt-1.5 text-[11px] text-muted-foreground">Shown to operators and customers.</p></div>
      <div><label htmlFor="template-customer" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer</label>{isSuper ? <select id="template-customer" className={selectClass} value={targetOrg} onChange={event => onTargetOrgChange(event.target.value)}><option value="">Select customer</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select> : <div className="flex h-9 items-center rounded-md border border-input bg-secondary/45 px-3 text-[12px] text-foreground">Current customer scope</div>}<p className="mt-1.5 text-[11px] text-muted-foreground">The policy can only read approved catalog metrics.</p></div>
    </div>
    <div><label htmlFor="template-description" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Description <span className="font-normal normal-case tracking-normal text-muted-foreground">(optional)</span></label><textarea id="template-description" className={textareaClass} value={description} maxLength={512} placeholder="What this policy is intended to watch…" onChange={event => onDescriptionChange(event.target.value)} /><div className="mt-1 flex justify-end text-[10px] text-muted-foreground">{description.length}/512</div></div>
    <div><div className="mb-2 flex items-baseline justify-between gap-3"><div><div className="text-[12px] font-semibold">Collection interval</div><p className="mt-0.5 text-[11px] text-muted-foreground">How often each assigned router sends these metrics.</p></div><span className="font-mono text-[11px] text-muted-foreground">60–300 seconds</span></div><div className="flex flex-wrap gap-2"><div className="inline-flex rounded-lg border border-border bg-secondary/40 p-1">{presets.map(value => <button key={value} type="button" className={`rounded-md px-4 py-2 text-[12px] font-medium transition-colors ${interval === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onIntervalChange(value)}>{value}s</button>)}<button type="button" className={`rounded-md px-4 py-2 text-[12px] font-medium transition-colors ${!isPreset ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onIntervalChange(isPreset ? 90 : interval)}>Custom</button></div>{!isPreset && <div className="flex items-center gap-2"><Input aria-label="Custom collection interval" type="number" min={60} max={300} value={interval} onChange={event => onIntervalChange(Number(event.target.value))} className="w-28" /><span className="text-[12px] text-muted-foreground">seconds</span></div>}</div></div>
  </CardContent></Card>;
}

function MetricsStep({ catalog, categories, activeCategory, onCategoryChange, metrics, selected, labels, onLabelChange, selectedOnly, onSelectedOnlyChange, search, onSearchChange, onMetricSelected, selectedCount }: { catalog: MonitoringCatalog | null; categories: string[]; activeCategory: string; onCategoryChange: (category: string) => void; metrics: CatalogMetric[]; selected: Set<string>; labels: Record<string, string>; onLabelChange: (id: string, value: string) => void; selectedOnly: boolean; onSelectedOnlyChange: (value: boolean) => void; search: string; onSearchChange: (value: string) => void; onMetricSelected: (id: string, checked: boolean) => void; selectedCount: number }) {
  return <Card className="overflow-hidden"><CardHeader className="border-b border-border"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Choose approved metrics</CardTitle><CardDescription>Only metrics in the server-owned catalog can be collected. Missing router capabilities remain unavailable rather than becoming zero.</CardDescription></div><Badge variant="accent">{selectedCount} selected</Badge></div></CardHeader><CardContent className="p-0"><div className="grid lg:grid-cols-[216px_minmax(0,1fr)]">
    <div className="border-b border-border bg-secondary/25 p-2 lg:border-b-0 lg:border-r"><div className="px-2 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Categories</div><div className="flex gap-1 overflow-x-auto lg:block">{categories.map(category => { const total = (catalog?.metrics || []).filter(metric => metric.category === category).length; const count = (catalog?.metrics || []).filter(metric => metric.category === category && selected.has(metric.id)).length; return <button key={category} type="button" onClick={() => onCategoryChange(category)} className={`flex min-w-max items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[12px] transition-colors lg:mb-1 lg:w-full ${activeCategory === category ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}><span className="truncate">{category}</span><span className="font-mono text-[10px] tabular-nums opacity-75">{count}/{total}</span></button>; })}</div></div>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 border-b border-border p-3"><div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search metrics" value={search} placeholder="Search metrics, descriptions, or IDs" className="pl-9" onChange={event => onSearchChange(event.target.value)} /></div><label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-[11px] text-muted-foreground"><input type="checkbox" className="size-3.5 accent-primary" checked={selectedOnly} onChange={event => onSelectedOnlyChange(event.target.checked)} />Selected only</label></div><div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5"><div className="text-[12px] font-medium">{activeCategory || "Catalog"}<span className="ml-2 text-[11px] font-normal text-muted-foreground">{metrics.length} matching</span></div>{search && <button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => onSearchChange("")}>Clear search</button>}</div><div className="divide-y divide-border">{metrics.map(metric => <MetricRow key={metric.id} metric={metric} checked={selected.has(metric.id)} label={labels[metric.id] || ""} onLabelChange={value => onLabelChange(metric.id, value)} onChange={checked => onMetricSelected(metric.id, checked)} />)}{!metrics.length && <div className="flex min-h-44 flex-col items-center justify-center gap-2 p-6 text-center"><Search className="size-5 text-muted-foreground/60" /><p className="text-[13px] font-medium">No metrics match this view</p><p className="text-[11px] text-muted-foreground">Try a different search or clear the selected-only filter.</p></div>}</div></div>
  </div></CardContent></Card>;
}

function MetricRow({ metric, checked, label, onLabelChange, onChange }: { metric: CatalogMetric; checked: boolean; label: string; onLabelChange: (value: string) => void; onChange: (checked: boolean) => void }) {
  return <div className={`px-4 py-3.5 transition-colors ${checked ? "bg-accent/45" : "hover:bg-secondary/30"}`}><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium">{metric.field.label}</span><Badge variant="secondary" className="font-mono text-[9px] font-normal uppercase">{metric.field.kind}</Badge>{metric.field.unit && <span className="font-mono text-[10px] text-muted-foreground">{metric.field.unit}</span>}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{metric.description || "Approved collector metric."}</span><span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground"><span>{metric.id}</span><span className="inline-flex items-center gap-1 text-ok"><ShieldCheck className="size-3" />{metric.required_capability ? `Capability: ${metric.required_capability}` : "Approved catalog metric"}</span></span></span></label>{checked && <div className="ml-7 mt-2 max-w-md"><Input aria-label={`Custom display label for ${metric.field.label}`} value={label} maxLength={128} placeholder="Custom display label (optional)" onChange={event => onLabelChange(event.target.value)} /></div>}</div>;
}

function ThresholdsStep({ catalog, selectedMetrics, gauges, states, expandedRules, setGauges, setStates, setExpandedRules, removeMetric, stale, setStale, staleSeverity, setStaleSeverity, devices, previewDevice, setPreviewDevice, preview, runPreview, busy }: { catalog: MonitoringCatalog | null; selectedMetrics: CatalogMetric[]; gauges: Record<string, GaugeDraft>; states: Record<string, StateValues>; expandedRules: Record<string, boolean>; setGauges: React.Dispatch<React.SetStateAction<Record<string, GaugeDraft>>>; setStates: React.Dispatch<React.SetStateAction<Record<string, StateValues>>>; setExpandedRules: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; removeMetric: (id: string) => void; stale: boolean; setStale: (value: boolean) => void; staleSeverity: "warning" | "critical"; setStaleSeverity: (value: "warning" | "critical") => void; devices: Device[]; previewDevice: string; setPreviewDevice: (value: string) => void; preview: PreviewItem[]; runPreview: () => void; busy: boolean }) {
  const previewById = new Map(preview.map(item => [item.metric_id, item]));
  const toggleRules = (id: string, enabled: boolean, kind: string) => {
    setExpandedRules(current => ({ ...current, [id]: enabled }));
    if (enabled && kind === "gauge") setGauges(current => ({ ...current, [id]: current[id] || emptyGauge() }));
    if (enabled && kind === "state") setStates(current => ({ ...current, [id]: current[id] || emptyStates() }));
  };
  const clearRules = (id: string) => {
    setExpandedRules(current => ({ ...current, [id]: false }));
    setGauges(current => { const next = { ...current }; delete next[id]; return next; });
    setStates(current => { const next = { ...current }; delete next[id]; return next; });
  };
  return <div className="space-y-5"><Card><CardHeader className="border-b border-border"><CardTitle>Thresholds are optional</CardTitle><CardDescription>A metric without rules is still collected and charted. Add rules only where this template should raise health alerts.</CardDescription></CardHeader><CardContent className="space-y-3 p-5">{selectedMetrics.map(metric => { const expanded = Boolean(expandedRules[metric.id]); const hasRules = metric.field.kind === "gauge" ? hasGaugeRules(gauges[metric.id]) : metric.field.kind === "state" ? hasStateRules(states[metric.id]) : false; return <div key={metric.id} className="rounded-lg border border-border bg-card"><div className="flex flex-wrap items-start justify-between gap-3 p-4"><div className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-md ${metric.field.kind === "gauge" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"}`}>{metric.field.kind === "gauge" ? "#" : "◌"}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold">{metric.field.label}</span><Badge variant="secondary" className="font-mono text-[9px] uppercase">{metric.field.kind}</Badge></div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{metric.id}{metric.field.unit ? ` · ${metric.field.unit}` : ""}</div></div></div><div className="flex items-center gap-1"><button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Remove ${metric.field.label}`} onClick={() => removeMetric(metric.id)}><X className="size-4" /></button></div></div>{!expanded && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-secondary/20 px-4 py-3"><span className="text-[11px] text-muted-foreground">{hasRules ? "Rules configured" : "No rules — collected only"}</span>{metric.field.kind === "gauge" || metric.field.kind === "state" ? <Button variant="outline" size="sm" onClick={() => toggleRules(metric.id, true, metric.field.kind)}>{hasRules ? "Edit rules" : "Add rules"}</Button> : <span className="text-[11px] text-muted-foreground">This metric is informational.</span>}</div>}{expanded && <div className="border-t border-border p-4">{metric.field.kind === "gauge" && <GaugeRules value={gauges[metric.id] || emptyGauge()} unit={metric.field.unit} onChange={value => setGauges(current => ({ ...current, [metric.id]: value }))} onRemove={() => clearRules(metric.id)} />}{metric.field.kind === "state" && <StateRules value={states[metric.id] || emptyStates()} onChange={value => setStates(current => ({ ...current, [metric.id]: value }))} onRemove={() => clearRules(metric.id)} />}{metric.field.kind !== "gauge" && metric.field.kind !== "state" && <p className="text-[12px] text-muted-foreground">No threshold rules are available for this informational metric.</p>}</div>}</div>; })}{!selectedMetrics.length && <div className="rounded-lg border border-dashed border-border p-8 text-center text-[12px] text-muted-foreground">Go back to Metrics and select at least one catalog metric.</div>}</CardContent></Card>
    <Card><CardHeader className="border-b border-border"><div className="flex items-start gap-3"><span className="grid size-8 place-items-center rounded-md bg-warn-bg text-warn"><Info className="size-4" /></span><div><CardTitle>Stale data alert</CardTitle><CardDescription>Raise an alert when a router misses two expected collection intervals.</CardDescription></div></div></CardHeader><CardContent className="flex flex-wrap items-center gap-3 p-5"><button type="button" role="switch" aria-checked={stale} onClick={() => setStale(!stale)} className={`relative h-6 w-11 rounded-full transition-colors ${stale ? "bg-primary" : "bg-secondary"}`}><span className={`absolute top-1 size-4 rounded-full bg-white shadow-sm transition-transform ${stale ? "left-6" : "left-1"}`} /></button><span className="text-[12px] font-medium">Alert after two missed intervals</span>{stale && <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-1"><button type="button" className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${staleSeverity === "warning" ? "bg-card text-warn shadow-sm" : "text-muted-foreground"}`} onClick={() => setStaleSeverity("warning")}>Warning</button><button type="button" className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${staleSeverity === "critical" ? "bg-card text-down shadow-sm" : "text-muted-foreground"}`} onClick={() => setStaleSeverity("critical")}>Critical</button></div>}</CardContent></Card>
    <Card><CardHeader className="border-b border-border"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Compatibility preview</CardTitle><CardDescription>Run the selected metrics against one connected router before publishing.</CardDescription></div><Badge variant="secondary">Read-only</Badge></div></CardHeader><CardContent className="space-y-4 p-5"><div className="flex flex-wrap gap-2"><select aria-label="Preview device" className={`${selectClass} max-w-[340px]`} value={previewDevice} onChange={event => setPreviewDevice(event.target.value)}><option value="">Select preview device</option>{devices.map(device => <option key={device.id} value={device.id}>{device.name || device.serial_number}</option>)}</select><Button variant="outline" onClick={runPreview} disabled={busy || !previewDevice || !selectedMetrics.length}><Eye className="size-3.5" />{busy ? "Checking…" : "Run preview"}</Button></div>{preview.length ? <div className="divide-y divide-border rounded-lg border border-border">{selectedMetrics.map(metric => { const result = previewById.get(metric.id); return <div key={metric.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-[11px]"><span><span className="font-medium">{metric.field.label}</span><span className="ml-2 font-mono text-muted-foreground">{metric.id}</span></span>{result?.available ? <span className="inline-flex items-center gap-1.5 text-ok"><CheckCircle2 className="size-3.5" />{result.value?.value === undefined ? "Available" : String(result.value.value)}</span> : <span className="text-muted-foreground">Unsupported / absent</span>}</div>; })}</div> : <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-secondary/20 p-3 text-[11px] text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" />Preview is optional. Unsupported values are left absent; they are never converted into zeroes.</div>}</CardContent></Card>
  </div>;
}

function DraftRail({ name, description, customerLabel, interval, catalogVersion, draftVersion, selectedMetrics, removeMetric, hasCustomer, hasName, hasInterval, hasMetrics }: { name: string; description: string; customerLabel: string; interval: number; catalogVersion?: number; draftVersion: number; selectedMetrics: CatalogMetric[]; removeMetric: (id: string) => void; hasCustomer: boolean; hasName: boolean; hasInterval: boolean; hasMetrics: boolean }) {
  const checklist = [{ label: "Name and customer set", done: hasName && hasCustomer }, { label: "Interval within 60–300 s", done: hasInterval }, { label: "At least one approved metric", done: hasMetrics }];
  return <aside className="space-y-4 xl:sticky xl:top-4"><Card><CardHeader className="border-b border-border"><div className="flex items-center justify-between"><CardTitle>Draft</CardTitle><Badge variant="secondary">Live preview</Badge></div></CardHeader><CardContent className="space-y-4 p-4"><div><div className="truncate text-[14px] font-semibold">{name || "Untitled template"}</div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{description || "Add a short description for operators."}</p></div><div className="flex flex-wrap gap-1.5"><Badge variant="secondary">{interval || "—"} s</Badge><Badge variant="secondary">catalog v{catalogVersion ?? "—"}</Badge><Badge variant={hasCustomer ? "accent" : "secondary"}>{customerLabel}</Badge></div><div className="border-t border-border pt-3"><div className="mb-2 flex items-center justify-between"><span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Selected metrics</span><span className="font-mono text-[10px] text-muted-foreground">{selectedMetrics.length}</span></div>{selectedMetrics.length ? <div className="space-y-1.5">{selectedMetrics.map(metric => <div key={metric.id} className="flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5"><span className="min-w-0 flex-1 truncate text-[11px]">{metric.field.label}</span><span className="font-mono text-[9px] text-muted-foreground">{metric.field.kind}</span><button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${metric.field.label}`} onClick={() => removeMetric(metric.id)}><X className="size-3.5" /></button></div>)}</div> : <p className="text-[11px] text-muted-foreground">No metrics selected yet.</p>}</div><div className="border-t border-border pt-3"><div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Ready checklist</div><div className="space-y-2">{checklist.map(item => <div key={item.label} className="flex items-center gap-2 text-[11px]"><span className={item.done ? "text-ok" : "text-muted-foreground"}>{item.done ? <CheckCircle2 className="size-3.5" /> : "○"}</span><span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span></div>)}<div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span>○</span><span>Thresholds are optional</span></div></div></div></CardContent></Card><div className="rounded-lg border border-border bg-secondary/25 p-3 text-[11px] leading-4 text-muted-foreground"><div className="mb-1 font-medium text-foreground">Immutable versions</div>Publishing this draft creates v{draftVersion}. Existing assignments remain on their current version until updated.</div></aside>;
}

function GaugeRules({ value, unit, onChange, onRemove }: { value: GaugeDraft; unit?: string; onChange: (value: GaugeDraft) => void; onRemove: () => void }) {
  const row = (severity: "warning" | "critical") => {
    const opKey = `${severity}Op` as "warningOp" | "criticalOp";
    const valueKey = `${severity}Value` as "warningValue" | "criticalValue";
    const minimumKey = `${severity}Minimum` as "warningMinimum" | "criticalMinimum";
    const maximumKey = `${severity}Maximum` as "warningMaximum" | "criticalMaximum";
    const title = severity === "warning" ? "Warn when" : "Critical when";
    return <div className="grid gap-2 sm:grid-cols-[110px_minmax(150px,1fr)_minmax(110px,160px)] sm:items-center"><span className={`text-[12px] font-medium ${severity === "warning" ? "text-warn" : "text-down"}`}>{title}</span><select className={selectClass} value={value[opKey]} onChange={event => onChange({ ...value, [opKey]: event.target.value as GaugeOperator })}><option value="gt">is above</option><option value="gte">is at or above</option><option value="lt">is below</option><option value="lte">is at or below</option><option value="outside">is outside</option></select>{value[opKey] === "outside" ? <div className="flex items-center gap-1.5"><Input aria-label={`${title} minimum`} type="number" placeholder="Min" value={value[minimumKey]} onChange={event => onChange({ ...value, [minimumKey]: event.target.value })} /><span className="text-muted-foreground">–</span><Input aria-label={`${title} maximum`} type="number" placeholder="Max" value={value[maximumKey]} onChange={event => onChange({ ...value, [maximumKey]: event.target.value })} /></div> : <div className="flex items-center gap-2"><Input aria-label={`${title} value`} type="number" placeholder="Value" value={value[valueKey]} onChange={event => onChange({ ...value, [valueKey]: event.target.value })} />{unit && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{unit}</span>}</div>}</div>;
  };
  return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[12px] font-semibold">Gauge rules</div><p className="mt-0.5 text-[11px] text-muted-foreground">Add a warning, critical rule, or both.</p></div><button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={onRemove}>Remove rules</button></div><div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">{row("warning")}{row("critical")}</div></div>;
}

function StateRules({ value, onChange, onRemove }: { value: StateValues; onChange: (value: StateValues) => void; onRemove: () => void }) {
  const [inputs, setInputs] = useState<Record<Severity, string>>({ healthy: "", warning: "", critical: "" });
  const addValue = (severity: Severity) => {
    const next = inputs[severity].trim();
    if (!next) return;
    const values = splitStateValues(value[severity]);
    if (!values.includes(next)) onChange({ ...value, [severity]: [...values, next].join(", ") });
    setInputs(current => ({ ...current, [severity]: "" }));
  };
  const removeValue = (severity: Severity, target: string) => onChange({ ...value, [severity]: splitStateValues(value[severity]).filter(item => item !== target).join(", ") });
  return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[12px] font-semibold">State rules</div><p className="mt-0.5 text-[11px] text-muted-foreground">Map observed state values to a health severity.</p></div><button type="button" className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={onRemove}>Remove rules</button></div><div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">{(["healthy", "warning", "critical"] as const).map(severity => <div key={severity} className="grid gap-2 sm:grid-cols-[92px_minmax(0,1fr)] sm:items-start"><span className={`pt-1 text-[11px] font-medium capitalize ${severity === "healthy" ? "text-ok" : severity === "warning" ? "text-warn" : "text-down"}`}>{severity}</span><div className="flex flex-wrap items-center gap-1.5">{splitStateValues(value[severity]).map(item => <span key={item} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-[11px]">{item}<button type="button" aria-label={`Remove ${item} from ${severity}`} className="text-muted-foreground hover:text-foreground" onClick={() => removeValue(severity, item)}><X className="size-3" /></button></span>)}<Input aria-label={`Add ${severity} state`} value={inputs[severity]} placeholder="Add observed value" className="h-8 min-w-[150px] flex-1" onChange={event => setInputs(current => ({ ...current, [severity]: event.target.value }))} onKeyDown={event => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addValue(severity); } }} /><Button type="button" variant="outline" size="sm" className="h-8" onClick={() => addValue(severity)}>Add</Button></div></div>)}</div></div>;
}

function splitStateValues(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
}

function hasGaugeRules(value?: GaugeDraft) {
  return Boolean(value && (value.warningValue !== "" || value.warningMinimum !== "" || value.warningMaximum !== "" || value.criticalValue !== "" || value.criticalMinimum !== "" || value.criticalMaximum !== ""));
}

function hasStateRules(value?: StateValues) {
  return Boolean(value && [value.healthy, value.warning, value.critical].some(item => splitStateValues(item).length > 0));
}
