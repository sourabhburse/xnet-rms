import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Check, FileUp, Plus, RefreshCw, Router, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { formatApiError } from "./api";
import { Organization, Product, Registration, TagItem, User, PendingDevice } from "./types";
import { identifierText } from "./lib/identifiers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Entry = { name: string; serial_number: string; lan_mac: string; identifiers?: Record<string, string>; tags: string[] };
type AddMode = "manual" | "csv";
type OnboardingTab = "available" | "awaiting" | "add";

const blank = (): Entry => ({ name: "", serial_number: "", lan_mac: "", tags: [] });
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

async function request<T = any>(path: string, method = "GET", value?: unknown, csv = false): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { method, credentials: "same-origin", headers: { "Content-Type": csv ? "text/csv" : "application/json" }, body: value === undefined ? undefined : csv ? String(value) : JSON.stringify(value) });
  if (response.status === 204) return null as T;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body as T;
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function Onboarding({ user, onRefresh }: { user: User; onRefresh?: () => void }) {
  const [org, setOrg] = useState(user.organization_id || "");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productID, setProductID] = useState("");
  const [rows, setRows] = useState<Entry[]>([blank()]);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("manual");
  const [activeTab, setActiveTab] = useState<OnboardingTab>("available");
  const [editing, setEditing] = useState<{ row: Registration | PendingDevice; claim: boolean } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Registration | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const selectedProduct = products.find((product) => product.id === productID) || products[0];
  const primaryRule = selectedProduct?.identity_schema?.find((rule) => rule.required) || selectedProduct?.identity_schema?.[0];
  const awaiting = useMemo(() => registrations.filter((item) => item.status === "awaiting_device"), [registrations]);
  const availableTags = useMemo(() => tags.filter((tag) => !org || tag.organization_id === org).map((tag) => tag.name), [org, tags]);

  const refresh = async () => {
    const suffix = org ? `?organization_id=${encodeURIComponent(org)}` : "";
    const [nextPending, nextRegistrations, nextTags, nextProducts] = await Promise.all([
      request<PendingDevice[]>(`pending-devices${suffix}`),
      request<Registration[]>(`registrations${suffix}`),
      request<TagItem[]>("tags"),
      request<Product[]>("products"),
    ]);
    setPending(nextPending || []);
    setRegistrations(nextRegistrations || []);
    setTags(nextTags || []);
    setProducts(nextProducts || []);
    if (!productID && nextProducts?.length) setProductID(nextProducts[0].id);
  };

  useEffect(() => {
    void refresh().catch((err) => setError(formatApiError(err).message));
    if (isSuperAdmin) void request<Organization[]>("organizations").then(setOrgs).catch(() => setOrgs([]));
    const timer = window.setInterval(() => void refresh().catch((err) => setError(formatApiError(err).message)), 15000);
    return () => window.clearInterval(timer);
  }, [user.organization_id, isSuperAdmin, org]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); onRefresh?.(); }
    catch (err) { setError(formatApiError(err).message); }
    finally { setBusy(false); }
  };

  const updateEntry = (index: number, key: keyof Entry, value: string | string[]) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  const submit = (entries: Entry[]) => run(async () => {
    const valid = entries.filter((entry) => entry.serial_number.trim() || entry.lan_mac.trim() || entry.name.trim());
    if (!org) throw new Error("Select a customer organization first.");
    if (!valid.length) throw new Error("Enter at least one device identity.");
    if (!selectedProduct) throw new Error("No active product is configured.");
    const mapped = valid.map((entry) => ({ ...entry, product_id: selectedProduct.id, identifiers: { ...(entry.identifiers || {}), ...(primaryRule && entry.lan_mac.trim() ? { [primaryRule.kind]: entry.lan_mac.trim() } : {}) } }));
    const response = await request<any[]>("registrations", "POST", { organization_id: org, product_id: selectedProduct.id, rows: mapped });
    setResults(response || []);
    setRows(valid.filter((_, index) => !response[index]?.success));
    setPreview([]);
    toast.success(`${response.filter((item) => item.success).length} registration${response.filter((item) => item.success).length === 1 ? "" : "s"} submitted`);
    await refresh();
    setActiveTab("awaiting");
  });

  const startEdit = (row: Registration | PendingDevice, claim: boolean) => {
    setEditing({ row, claim });
    setEditName("name" in row ? row.name || "" : "");
    setEditTags("tags" in row ? row.tags || [] : []);
  };
  const saveEdit = () => {
    if (!editing) return;
    const target = editing;
    return run(async () => {
      await request(target.claim ? `pending-devices/${target.row.id}/claim` : `registrations/${target.row.id}`, target.claim ? "POST" : "PATCH", { name: editName, tags: editTags });
      setEditing(null);
      await refresh();
    });
  };
  const cancelRegistration = () => {
    if (!cancelTarget) return;
    const target = cancelTarget;
    return run(async () => { await request(`registrations/${target.id}`, "DELETE"); setCancelTarget(null); await refresh(); });
  };

  return (
    <div className="-m-6 min-h-full bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 pb-[18px] pt-6">
        <div><h1 className="font-display text-[22px] font-semibold tracking-[-0.01em]">Onboarding</h1><p className="mt-1 text-[13px] text-muted-foreground">{pending.length} router{pending.length === 1 ? "" : "s"} available to claim · {awaiting.length} pre-registered and awaiting first check-in</p></div>
        <div className="flex flex-wrap gap-2">{isSuperAdmin && <select aria-label="Onboarding customer scope" className="h-8 min-w-[190px] rounded-md border border-input bg-card px-2.5 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25" value={org} onChange={(event) => { setOrg(event.target.value); setPreview([]); setResults([]); }}><option value="">All customers</option>{orgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<Button variant="outline" size="sm" onClick={() => void run(refresh)} disabled={busy}><RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button><Button size="sm" onClick={() => setActiveTab("add")}><Plus className="size-3.5" />Add devices</Button></div>
      </header>

      {error && <div role="alert" className="mx-6 mt-4 flex items-start justify-between gap-3 rounded-md border border-down-border bg-down-bg px-3.5 py-3 text-[12px] text-down"><span>{error}</span><button type="button" className="font-medium underline underline-offset-2" onClick={() => setError("")}>Dismiss</button></div>}

      <nav className="flex gap-5 border-b border-border px-6" aria-label="Onboarding sections">
        {(["available", "awaiting", "add"] as OnboardingTab[]).map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`py-3 text-[13px] ${activeTab === tab ? "font-semibold text-primary shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground"}`}>{tab === "available" ? "Available to claim" : tab === "awaiting" ? "Awaiting device" : "Add devices"}{tab !== "add" && <span className="ml-1.5 font-mono text-[11px]">{tab === "available" ? pending.length : awaiting.length}</span>}</button>)}
      </nav>

      <section className="grid grid-cols-1 border-b border-border sm:grid-cols-2">
        <button type="button" onClick={() => setActiveTab("available")} className={`border-b border-border px-6 py-4 text-left sm:border-b-0 sm:border-r ${activeTab === "available" ? "bg-kpi-warn-bg" : "hover:bg-secondary/35"}`}><span className="font-mono text-[11px] uppercase tracking-[0.08em] text-warn">Available to claim</span><span className="mt-2 block font-display text-[32px] font-semibold leading-none tabular-nums text-warn">{pending.length}</span><span className="mt-2 block text-[12px] text-muted-foreground">Connected through an enrollment token or factory challenge</span></button>
        <button type="button" onClick={() => setActiveTab("awaiting")} className={`px-6 py-4 text-left ${activeTab === "awaiting" ? "bg-secondary/35" : "hover:bg-secondary/35"}`}><span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Awaiting device</span><span className="mt-2 block font-display text-[32px] font-semibold leading-none tabular-nums">{awaiting.length}</span><span className="mt-2 block text-[12px] text-muted-foreground">Pre-registered, no first boot check-in yet</span></button>
      </section>

      {activeTab === "available" && <section>
        <div className="px-6 pb-3 pt-[18px]"><h2 className="font-display text-[15px] font-semibold">Available to claim</h2><p className="mt-1 text-[13px] text-muted-foreground">Connected devices ready for ownership in this customer workspace.</p></div>
        <div className="hidden grid-cols-[2fr_1.1fr_1.2fr_1fr_auto] gap-4 border-y border-border bg-secondary/25 px-6 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground md:grid"><span>Device identity</span><span>Model</span><span>Status</span><span>Last active</span><span /></div>
        {pending.map((item) => <div key={item.id} className="grid gap-3 border-b border-row-divider border-l-[3px] border-l-warn-rail px-6 py-3 md:grid-cols-[2fr_1.1fr_1.2fr_1fr_auto] md:items-center md:gap-4"><span className="flex min-w-0 items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-md border border-accent bg-accent text-accent-foreground"><Router className="size-4" /></span><span className="min-w-0"><span className="block truncate font-mono text-[12px] font-semibold">{item.serial_number}</span><span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{identifierText(item.identifiers, item.lan_mac)}</span>{isSuperAdmin && !org && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{orgs.find((organization) => organization.id === item.organization_id)?.name || item.organization_id}</span>}</span></span><span className="text-[13px]">{item.model || "Niseva router"}</span><span className="text-[13px] text-warn">Available to claim</span><span className="font-mono text-[11px] text-muted-foreground">{dateLabel(item.last_seen)}</span><Button size="sm" className="h-7 px-2.5 text-[12px]" onClick={() => startEdit(item, true)}>Claim device</Button></div>)}
        {!pending.length && <EmptyState icon={<Router className="size-5" />} title="No devices awaiting claim" note="Connected devices will appear here when ready." />}
      </section>}

      {activeTab === "awaiting" && <section>
        <div className="px-6 pb-3 pt-[18px]"><h2 className="font-display text-[15px] font-semibold">Awaiting device connection</h2><p className="mt-1 text-[13px] text-muted-foreground">Pre-registered identities that have not completed their first check-in.</p></div>
        <div className="hidden grid-cols-[2.2fr_1.3fr_1.1fr_1fr_auto] gap-4 border-y border-border bg-secondary/25 px-6 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground md:grid"><span>Device identity</span><span>Tags</span><span>State</span><span>Created</span><span /></div>
        {awaiting.map((item) => <div key={item.id} className="grid gap-3 border-b border-row-divider border-l-[3px] border-l-warn-rail px-6 py-3 md:grid-cols-[2.2fr_1.3fr_1.1fr_1fr_auto] md:items-center md:gap-4"><span className="min-w-0"><span className="block truncate font-mono text-[12px] font-semibold">{item.serial_number}</span><span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{item.name || "Unnamed device"} · <span className="font-mono text-[11px]">{identifierText(item.identifiers, item.lan_mac)}</span></span>{isSuperAdmin && !org && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{orgs.find((organization) => organization.id === item.organization_id)?.name || item.organization_id}</span>}</span><span className="flex flex-wrap gap-1">{item.tags?.length ? item.tags.map((tag) => <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>) : <span className="text-[12px] text-muted-foreground">None</span>}</span><span><span className="block text-[13px] text-warn">Awaiting device</span><span className="font-mono text-[11px] text-muted-foreground">awaiting_device</span></span><span className="font-mono text-[11px] text-muted-foreground">{dateLabel(item.created_at)}</span><span className="flex justify-end gap-1.5"><Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px]" onClick={() => startEdit(item, false)}>Edit</Button><Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px] text-destructive hover:text-destructive" onClick={() => setCancelTarget(item)}>Cancel</Button></span></div>)}
        {!awaiting.length && <EmptyState icon={<Router className="size-5" />} title="No devices awaiting first check-in" note="New pre-registrations will appear here." />}
      </section>}

      {activeTab === "add" && <section>
        <div className="border-b border-border bg-secondary/25 px-6 py-4"><div className="grid gap-4 lg:grid-cols-2">{isSuperAdmin && <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Customer organization<select className={`mt-1.5 ${selectClass}`} value={org} onChange={(event) => { setOrg(event.target.value); setPreview([]); setResults([]); }}><option value="">Select customer</option>{orgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="mt-1.5 block normal-case tracking-normal">All registrations are scoped to this customer.</span></label>}<label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Product<select className={`mt-1.5 ${selectClass}`} value={selectedProduct?.id || productID} onChange={(event) => { setProductID(event.target.value); setPreview([]); setResults([]); }}><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.code})</option>)}</select>{selectedProduct && <span className="mt-1.5 block normal-case tracking-normal">Serial number required{selectedProduct.identity_schema.length ? ` · ${selectedProduct.identity_schema.map((rule) => rule.label || rule.kind).join(", ")}` : ""}</span>}</label></div></div>
        <div className="flex gap-5 border-b border-border px-6"><button type="button" onClick={() => setAddMode("manual")} className={`py-3 text-[13px] ${addMode === "manual" ? "font-semibold text-primary shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground"}`}>Manual entry</button><button type="button" onClick={() => setAddMode("csv")} className={`py-3 text-[13px] ${addMode === "csv" ? "font-semibold text-primary shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground"}`}>Batch CSV import</button></div>

        {addMode === "manual" && <div className="px-6 py-5"><div className="hidden grid-cols-[28px_1.05fr_1fr_1.1fr_1.25fr_34px] gap-3 border-b border-border pb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground lg:grid"><span>#</span><span>Name</span><span>Serial number</span><span>{primaryRule?.label || primaryRule?.kind || "Secondary identity"}</span><span>Tags</span><span /></div><div className="divide-y divide-row-divider">{rows.map((row, index) => <div key={index} className="grid gap-2.5 py-3 lg:grid-cols-[28px_1.05fr_1fr_1.1fr_1.25fr_34px] lg:items-center lg:gap-3"><span className="font-mono text-[11px] text-muted-foreground">{index + 1}</span><Input aria-label={`Device name ${index + 1}`} placeholder="Name (optional)" maxLength={128} value={row.name} onChange={(event) => updateEntry(index, "name", event.target.value)} /><Input aria-label={`Serial number ${index + 1}`} placeholder="Serial number" maxLength={63} value={row.serial_number} className="font-mono text-[11px]" onChange={(event) => updateEntry(index, "serial_number", event.target.value)} /><Input aria-label={`${primaryRule?.label || primaryRule?.kind || "Secondary identifier"} ${index + 1}`} placeholder={primaryRule?.normalize === "mac" ? "AA:BB:CC:DD:EE:FF" : primaryRule?.label || primaryRule?.kind || "Optional"} maxLength={primaryRule?.normalize === "mac" ? 17 : undefined} value={row.lan_mac} className="font-mono text-[11px]" onChange={(event) => updateEntry(index, "lan_mac", event.target.value)} /><Input aria-label={`Tags ${index + 1}`} list="onboarding-tags" placeholder="tag-a, tag-b" value={row.tags.join(", ")} onChange={(event) => updateEntry(index, "tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /><Button variant="ghost" size="icon" aria-label={`Remove row ${index + 1}`} onClick={() => setRows((current) => current.length === 1 ? [blank()] : current.filter((_, rowIndex) => rowIndex !== index))} disabled={busy}><Trash2 className="size-4 text-destructive" /></Button></div>)}</div><datalist id="onboarding-tags">{availableTags.map((tag) => <option key={tag} value={tag} />)}</datalist><div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => setRows((current) => [...current, blank()])} disabled={rows.length >= 500 || busy}><Plus className="size-3.5" />Add another row</Button><span className="mr-auto text-[12px] text-muted-foreground">Maximum 500 rows per submission.</span><Button onClick={() => void submit(rows)} disabled={busy || !org || !selectedProduct}>Register devices</Button></div></div>}

        {addMode === "csv" && <div className="space-y-4 px-6 py-5"><div className="flex justify-end"><a download="xnet-rms-devices.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(["name", "serial_number", ...(selectedProduct?.identity_schema.map((rule) => rule.kind) || []), "tags"].join(",") + "\n")}`}><Button variant="outline" asChild><span><FileUp className="size-3.5" />Download template</span></Button></a></div><label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/25 px-4 py-10 text-center hover:border-primary/50"><FileUp className="size-6 text-primary" /><span className="text-[13px] font-medium">Choose a CSV file</span><span className="font-mono text-[11px] text-muted-foreground">name, serial_number, lan_mac, tags · maximum 1 MiB</span><input aria-label="Device CSV" type="file" accept=".csv,text/csv" className="sr-only" disabled={!org || !selectedProduct || busy} onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; setPreview([]); if (file) void run(async () => { if (file.size > 1048576) throw new Error("Maximum file size is 1 MiB"); setPreview(await request<any[]>(`registrations/preview?organization_id=${encodeURIComponent(org)}&product_id=${encodeURIComponent(selectedProduct?.id || "")}`, "POST", await file.text(), true)); }); event.target.value = ""; }} /></label>{preview.length > 0 && <><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-semibold">Validation preview <span className="font-mono text-[11px] text-muted-foreground">({preview.filter((item) => item.valid).length} valid / {preview.length} total)</span></span><Button onClick={() => void submit(preview.filter((item) => item.valid).map((item) => item.data))} disabled={!preview.some((item) => item.valid) || busy}>Confirm &amp; register valid rows</Button></div><div className="overflow-x-auto border border-border"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Serial</TableHead><TableHead>Identifiers</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{preview.map((item) => <TableRow key={item.row}><TableCell className="font-mono text-[11px]">{item.row}</TableCell><TableCell className="font-mono text-[11px]">{item.data?.serial_number}</TableCell><TableCell className="font-mono text-[11px]">{identifierText(item.data?.identifiers, item.data?.lan_mac)}</TableCell><TableCell className={item.valid ? "text-ok" : "text-down"}>{item.valid ? <span className="inline-flex items-center gap-1"><Check className="size-3" />Valid</span> : item.error || "Invalid"}</TableCell></TableRow>)}</TableBody></Table></div></>}</div>}

        {!!results.length && <div className="border-t border-border px-6 py-5"><h2 className="font-display text-[15px] font-semibold">Registration result</h2><div className="mt-3 overflow-x-auto border border-border"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Result</TableHead><TableHead>Registration ID</TableHead></TableRow></TableHeader><TableBody>{results.map((item, index) => <TableRow key={index}><TableCell className="font-mono text-[11px]">{item.row ?? index + 1}</TableCell><TableCell className={item.success ? "text-ok" : "text-down"}>{item.success ? "Registered" : item.error || "Failed"}</TableCell><TableCell className="font-mono text-[11px] text-muted-foreground">{item.id || "—"}</TableCell></TableRow>)}</TableBody></Table></div></div>}
        <div className="border-t border-border bg-secondary/25 px-6 py-3 text-[12px] text-muted-foreground">Registered identities appear under Awaiting device until their first secure check-in.</div>
      </section>}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}><DialogContent><DialogHeader><DialogTitle>{editing?.claim ? "Claim device" : "Edit registration"}</DialogTitle><DialogDescription>Set a friendly name and optional customer tags.</DialogDescription></DialogHeader><div className="space-y-4"><Input aria-label="Device name" placeholder="Name (optional)" maxLength={128} value={editName} onChange={(event) => setEditName(event.target.value)} /><Input aria-label="Device tags" list="edit-onboarding-tags" placeholder="Comma-separated tags" value={editTags.join(", ")} onChange={(event) => setEditTags(event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /><datalist id="edit-onboarding-tags">{availableTags.map((tag) => <option key={tag} value={tag} />)}</datalist></div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={busy}>{busy ? "Saving…" : editing?.claim ? "Confirm & claim" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
      <ConfirmDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)} title="Cancel this registration?" description={cancelTarget ? `Pre-registration for ${cancelTarget.serial_number} will be removed.` : "This pre-registration will be removed."} confirmLabel="Cancel registration" onConfirm={cancelRegistration} />
    </div>
  );
}

function EmptyState({ icon, title, note }: { icon: ReactNode; title: string; note: string }) {
  return <div className="flex min-h-44 flex-col items-center justify-center gap-1 px-6 text-center text-muted-foreground"><span className="mb-1">{icon}</span><p className="text-[13px] font-medium text-foreground">{title}</p><p className="text-[12px]">{note}</p></div>;
}
