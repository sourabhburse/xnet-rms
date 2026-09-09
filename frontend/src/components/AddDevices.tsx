import React, { useEffect, useState } from "react";
import { Check, Download, FileUp, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Organization, TagItem, User } from "../types";
import { api, formatApiError } from "../api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AddDevicesProps {
  user: User;
  organizations: Organization[];
  tags: TagItem[];
  selectedOrg: string;
  onSuccess: () => void;
  onRefreshTags: () => void;
}

interface ManualRow {
  key: string;
  name: string;
  serial_number: string;
  lan_mac: string;
  tags: string[];
}

const emptyRow = (): ManualRow => ({ key: Math.random().toString(36).substring(7), name: "", serial_number: "", lan_mac: "", tags: [] });

const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

function FormLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}{required && <span className="ml-0.5 text-destructive">*</span>}</label>;
}

function TagEditor({ value, onChange, options, placeholder }: { value: string[]; onChange: (value: string[]) => void; options: string[]; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const next = raw.trim();
    if (!next || value.includes(next)) return;
    onChange([...value, next]);
    setDraft("");
  };
  return <div className="min-w-[210px] flex-1 rounded-md border border-input bg-card px-2 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
    <div className="flex flex-wrap gap-1">{value.map((tag) => <Badge key={tag} variant="secondary" className="gap-1 font-normal">{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((item) => item !== tag))}><X className="size-3" /></button></Badge>)}</div>
    <input list={options.length ? "customer-tag-options" : undefined} value={draft} placeholder={value.length ? "Add another tag" : placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(draft.replace(/,$/, "")); } }} onBlur={() => add(draft)} className="mt-1 h-5 w-full bg-transparent px-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground" />
    {options.length > 0 && <datalist id="customer-tag-options">{options.map((option) => <option key={option} value={option} />)}</datalist>}
  </div>;
}

function FormError({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-down-border bg-down-bg px-3.5 py-3 text-[12px] text-down"><span>{children}</span><button type="button" onClick={onClose} className="font-medium underline underline-offset-2">Dismiss</button></div>;
}

export default function AddDevices({ user, organizations, tags, selectedOrg, onSuccess, onRefreshTags }: AddDevicesProps) {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const [org, setOrg] = useState(selectedOrg || user.organization_id || "");
  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [submissionResults, setSubmissionResults] = useState<any[]>([]);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [csvValidating, setCsvValidating] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => { if (selectedOrg) setOrg(selectedOrg); }, [selectedOrg]);
  const availableTags = (tags || []).filter((tag) => !org || tag.organization_id === org).map((tag) => tag.name);
  const updateRow = (key: string, field: keyof ManualRow, value: string | string[]) => setManualRows((rows) => rows.map((row) => row.key === key ? { ...row, [field]: value } : row));
  const addRow = () => { if (manualRows.length >= 500) { toast.warning("Maximum 500 rows allowed per registration request."); return; } setManualRows((rows) => [...rows, emptyRow()]); };
  const removeRow = (key: string) => setManualRows((rows) => rows.length === 1 ? [emptyRow()] : rows.filter((row) => row.key !== key));

  const handleManualSubmit = async () => {
    setFormError("");
    if (!org) { setFormError("Organization is required. Please select an organization."); return; }
    const filledRows = manualRows.filter((row) => row.serial_number.trim() || row.lan_mac.trim() || row.name.trim());
    if (!filledRows.length) { setFormError("Please enter at least one device with serial number and LAN MAC."); return; }
    for (let index = 0; index < filledRows.length; index += 1) {
      if (!filledRows[index].serial_number.trim()) { setFormError(`Row ${index + 1}: Serial number is required.`); return; }
      if (!filledRows[index].lan_mac.trim()) { setFormError(`Row ${index + 1}: LAN MAC address is required.`); return; }
    }
    setSubmitting(true); setSubmissionResults([]);
    try {
      const results = await api<any[]>("registrations", "POST", { organization_id: org, rows: filledRows.map((row) => ({ name: row.name.trim(), serial_number: row.serial_number.trim(), lan_mac: row.lan_mac.trim(), tags: row.tags || [] })) });
      setSubmissionResults(results);
      if (results.every((result) => result.success)) { toast.success(`Successfully registered ${results.length} devices!`); setManualRows([emptyRow()]); onSuccess(); onRefreshTags(); }
      else { const failed = results.map((result, index) => !result.success ? index : null).filter((index): index is number => index !== null); setManualRows(filledRows.filter((_, index) => failed.includes(index))); toast.warning("Some rows had conflicts or invalid formats. Check results below."); }
    } catch (err) { setFormError(formatApiError(err).message); } finally { setSubmitting(false); }
  };

  const handleCsvUpload = async (file: File) => {
    setFormError(""); setCsvPreview([]);
    if (!org) { setFormError("Please select a customer organization before uploading CSV."); return; }
    if (file.size > 1048576) { setFormError("CSV file size exceeds 1 MiB limit."); return; }
    setCsvValidating(true);
    try { const preview = await api<any[]>(`registrations/preview?organization_id=${encodeURIComponent(org)}`, "POST", await file.text(), true); setCsvPreview(preview); }
    catch (err) { setFormError(formatApiError(err).message); } finally { setCsvValidating(false); }
  };

  const handleCsvConfirm = async () => {
    const validRows = csvPreview.filter((row) => row.valid).map((row) => row.data);
    if (!validRows.length) { toast.warning("No valid rows to register."); return; }
    setSubmitting(true);
    try { const results = await api<any[]>("registrations", "POST", { organization_id: org, rows: validRows }); setSubmissionResults(results); toast.success(`Registered ${results.filter((result) => result.success).length} devices!`); setCsvPreview([]); onSuccess(); onRefreshTags(); }
    catch (err) { setFormError(formatApiError(err).message); } finally { setSubmitting(false); }
  };

  return <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
    <div><h1 className="font-display text-[20px] font-semibold">Add devices</h1><p className="mt-1 text-[13px] text-muted-foreground">Pre-register routers by serial number and LAN MAC address for instant auto-provisioning.</p></div>
    {formError && <FormError onClose={() => setFormError("")}>{formError}</FormError>}
    {isSuperAdmin && <Card><CardContent className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-[180px]"><FormLabel>Target customer organization</FormLabel><select aria-label="Select target customer" value={org} onChange={(event) => setOrg(event.target.value)} className={selectClass}><option value="">Select organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div><p className="mt-5 text-xs text-muted-foreground">All registrations are scoped to this customer.</p></CardContent></Card>}
    <Tabs defaultValue="manual">
      <TabsList><TabsTrigger value="manual">Manual entry</TabsTrigger><TabsTrigger value="csv">Batch CSV import</TabsTrigger></TabsList>
      <TabsContent value="manual" className="mt-4"><Card><CardHeader><CardTitle>Router identities</CardTitle><CardDescription>Add one or more device identities. Tags are optional and can be entered as you go.</CardDescription></CardHeader><CardContent className="p-4 pt-0">
        <div className="hidden grid-cols-[28px_1.05fr_1fr_1.1fr_1.25fr_34px] gap-3 border-b border-border pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid"><span>#</span><span>Name</span><span>Serial number</span><span>LAN MAC</span><span>Tags</span><span /></div>
        <div className="divide-y divide-border">{manualRows.map((row, index) => <div key={row.key} className="grid gap-2.5 py-3 lg:grid-cols-[28px_1.05fr_1fr_1.1fr_1.25fr_34px] lg:items-center lg:gap-3"><span className="font-mono text-[11px] text-muted-foreground">{index + 1}</span><div><label className="sr-only">Device name {index + 1}</label><Input placeholder="Device name (optional)" value={row.name} maxLength={128} onChange={(event) => updateRow(row.key, "name", event.target.value)} /></div><div><label className="sr-only">Serial number {index + 1}</label><Input placeholder="Serial number" value={row.serial_number} maxLength={63} className="font-mono text-[11px]" onChange={(event) => updateRow(row.key, "serial_number", event.target.value)} /></div><div><label className="sr-only">LAN MAC {index + 1}</label><Input placeholder="AA:BB:CC:DD:EE:FF" value={row.lan_mac} maxLength={17} className="font-mono text-[11px]" onChange={(event) => updateRow(row.key, "lan_mac", event.target.value)} /></div><TagEditor value={row.tags} onChange={(value) => updateRow(row.key, "tags", value)} options={availableTags} placeholder="Add customer tags" /><Button variant="ghost" size="icon" aria-label={`Remove row ${index + 1}`} onClick={() => removeRow(row.key)} disabled={manualRows.length === 1 && !row.serial_number && !row.lan_mac}><Trash2 className="size-4 text-destructive" /></Button></div>)}</div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-4"><Button variant="outline" onClick={addRow} disabled={submitting}><Plus className="size-4" />Add another row</Button><Button onClick={handleManualSubmit} disabled={!org || submitting}>{submitting ? "Registering…" : "Register devices"}</Button></div>
      </CardContent></Card></TabsContent>
      <TabsContent value="csv" className="mt-4"><Card><CardHeader><CardTitle>Batch CSV import</CardTitle><CardDescription>Upload a standard CSV to register up to 500 routers at once.</CardDescription></CardHeader><CardContent className="space-y-4 p-4 pt-0"><a download="xnet-rms-devices-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent("name,serial_number,lan_mac,tags\nOffice Router,2S24090001,00:11:22:33:44:55,hq;branch\nWarehouse Router,2S24090002,AA:BB:CC:DD:EE:FF,warehouse\n")}`}><Button variant="outline" asChild><span><Download className="size-4" />Download CSV template</span></Button></a><label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/35 px-4 py-8 text-center transition-colors hover:border-primary/50"><FileUp className="size-6 text-primary" /><span className="text-[13px] font-medium">Choose a CSV file</span><span className="text-xs text-muted-foreground">name,serial_number,lan_mac,tags · maximum 1 MiB</span><input type="file" accept=".csv,text/csv" className="sr-only" disabled={!org || csvValidating} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleCsvUpload(file); event.target.value = ""; }} /></label>{csvValidating && <p className="text-xs text-muted-foreground">Validating CSV rows against the database…</p>}{csvPreview.length > 0 && <div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="text-[13px] font-semibold">Validation preview <span className="font-mono text-xs text-muted-foreground">({csvPreview.filter((row) => row.valid).length} valid / {csvPreview.length} total)</span></div><Button onClick={handleCsvConfirm} disabled={!csvPreview.some((row) => row.valid) || submitting}>{submitting ? "Registering…" : "Confirm & register valid rows"}</Button></div><div className="overflow-hidden rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Serial</TableHead><TableHead>LAN MAC</TableHead><TableHead>Tags</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{csvPreview.map((row) => <TableRow key={row.row}><TableCell className="font-mono text-[11px]">{row.row}</TableCell><TableCell>{row.data?.name || "—"}</TableCell><TableCell className="font-mono text-[11px]">{row.data?.serial_number}</TableCell><TableCell className="font-mono text-[11px]">{row.data?.lan_mac}</TableCell><TableCell><div className="flex flex-wrap gap-1">{row.data?.tags?.map((tag: string) => <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>)}</div></TableCell><TableCell><Badge variant={row.valid ? "ok" : "down"}><span className="size-1.5 rounded-full bg-current" />{row.valid ? "Valid" : row.error || "Invalid"}</Badge></TableCell></TableRow>)}</TableBody></Table></div></div>}</CardContent></Card></TabsContent>
    </Tabs>
    {submissionResults.length > 0 && <Card><CardHeader><CardTitle>Registration result report</CardTitle><CardDescription>Results from the latest registration request.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{submissionResults.map((result, index) => <TableRow key={`${result.row ?? "row"}-${index}`}><TableCell className="font-mono text-[11px]">{result.row ?? index + 1}</TableCell><TableCell><Badge variant={result.success ? "ok" : "down"}>{result.success ? <><Check className="size-3" />Registered successfully{result.id ? ` · ${result.id}` : ""}</> : `Failed: ${result.error || "Conflict or invalid data"}`}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
  </div>;
}
