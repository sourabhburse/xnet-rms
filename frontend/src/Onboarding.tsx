import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Check, FileUp, KeyRound, Plus, RefreshCw, Router, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { formatApiError } from "./api";
import { DeviceGroup, EnrollmentToken, Organization, Product, Registration, TagItem, User, PendingDevice } from "./types";
import { identifierText } from "./lib/identifiers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Entry = { name: string; serial_number: string; lan_mac: string; identifiers?: Record<string, string>; tags: string[] };
type AddMode = "manual" | "csv" | "token";
type QueueTab = "awaiting" | "available" | "claims" | "rejected";

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
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not reported" : date.toLocaleString();
}

function Kpi({ label, value, note, tone = "neutral" }: { label: string; value: number; note: string; tone?: "neutral" | "warn" | "ok" }) {
  const color = tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-foreground";
  return <Card className="rounded-none border-0 border-b border-r border-border shadow-none last:border-r-0"><CardContent className="p-4"><div className="font-mono text-[11px] uppercase text-muted-foreground">{label}</div><div className={`mt-2 font-display text-[26px] font-semibold leading-none tabular-nums ${color}`}>{value}</div><div className="mt-2 text-[12px] text-muted-foreground">{note}</div></CardContent></Card>;
}

export default function Onboarding({ user, onRefresh }: { user: User; onRefresh?: () => void }) {
  const [org, setOrg] = useState(user.organization_id || "");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productID, setProductID] = useState("");
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [rows, setRows] = useState<Entry[]>([blank()]);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [preview, setPreview] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("manual");
  const [queueTab, setQueueTab] = useState<QueueTab>("awaiting");
  const [editing, setEditing] = useState<{ row: any; claim: boolean } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Registration | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<EnrollmentToken | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tokenForm, setTokenForm] = useState({ name: "", max_uses: 1, group_ids: [] as string[] });
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const canManage = isSuperAdmin;
  const selectedProduct = products.find((product) => product.id === productID) || products[0];
  const primaryRule = selectedProduct?.identity_schema?.find((rule) => rule.required) || selectedProduct?.identity_schema?.[0];
  const awaiting = useMemo(() => registrations.filter((item) => item.status === "awaiting_device"), [registrations]);
  const rejected = useMemo(() => registrations.filter((item) => item.status === "canceled"), [registrations]);
  const claimRequests: Registration[] = [];
  const availableTags = useMemo(() => tags.filter((tag) => !org || tag.organization_id === org).map((tag) => tag.name), [org, tags]);
  const scopedGroups = useMemo(() => groups.filter((group) => !org || group.organization_id === org), [groups, org]);

  const refresh = async () => {
    const suffix = org ? `?organization_id=${encodeURIComponent(org)}` : "";
    const [nextPending, nextRegistrations, nextTags, nextGroups, nextTokens, nextProducts] = await Promise.all([
      request<PendingDevice[]>(`pending-devices${suffix}`),
      request<Registration[]>(`registrations${suffix}`),
      request<TagItem[]>("tags"),
      request<DeviceGroup[]>(`groups${suffix}`),
      canManage ? request<EnrollmentToken[]>(`enrollment-tokens${suffix}`) : Promise.resolve([]),
      request<Product[]>("products"),
    ]);
    setPending(nextPending || []);
    setRegistrations(nextRegistrations || []);
    setTags(nextTags || []);
    setGroups(nextGroups || []);
    setTokens(nextTokens || []);
    setProducts(nextProducts || []);
    if (!productID && nextProducts?.length) setProductID(nextProducts[0].id);
  };

  useEffect(() => {
    void refresh().catch((err) => setError(formatApiError(err).message));
    if (isSuperAdmin) void request<Organization[]>("organizations").then(setOrgs).catch(() => setOrgs([]));
    const timer = window.setInterval(() => void refresh().catch((err) => setError(formatApiError(err).message)), 15000);
    return () => window.clearInterval(timer);
  }, [user.organization_id, isSuperAdmin, org, canManage, productID]);

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
    setQueueTab("awaiting");
  });

  const startEdit = (row: Registration | PendingDevice, claim: boolean) => { setEditing({ row, claim }); setEditName("name" in row ? row.name || "" : ""); setEditTags("tags" in row ? row.tags || [] : []); };
  const saveEdit = () => {
    if (!editing) return;
    const target = editing;
    return run(async () => {
      await request(target.claim ? `pending-devices/${target.row.id}/claim` : `registrations/${target.row.id}`, target.claim ? "POST" : "PATCH", { name: editName, tags: editTags });
      setEditing(null);
      await refresh();
    });
  };

  const cancelRegistration = () => { if (!cancelTarget) return; const target = cancelTarget; return run(async () => { await request(`registrations/${target.id}`, "DELETE"); setCancelTarget(null); await refresh(); }); };
  const revokeToken = () => { if (!revokeTarget) return; const target = revokeTarget; return run(async () => { await request(`enrollment-tokens/${target.id}`, "DELETE"); setRevokeTarget(null); await refresh(); }); };
  const createToken = () => run(async () => {
    if (!org || !tokenForm.name.trim()) throw new Error("Select a customer and enter a token name.");
    const response = await request<{ token: string }>("enrollment-tokens", "POST", { ...tokenForm, name: tokenForm.name.trim(), organization_id: org, expires_at: null });
    setCreatedToken(response.token);
    setTokenForm({ name: "", max_uses: 1, group_ids: [] });
    await refresh();
  });

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-primary"><KeyRound className="size-3.5" />Fleet setup</div><h1 className="mt-1 font-display text-[22px] font-semibold text-balance">Onboarding</h1><p className="mt-1 max-w-2xl text-[13px] text-muted-foreground text-pretty">Register router identities, claim devices that have checked in, and manage the credentials used for secure enrollment.</p></div>
        <Button variant="outline" size="sm" onClick={() => void run(refresh)} disabled={busy}><RefreshCw className="size-3.5" />Refresh</Button>
      </header>
      {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-down-border bg-down-bg px-3.5 py-3 text-[12px] text-down"><span>{error}</span><button type="button" className="font-medium underline underline-offset-2" onClick={() => setError("")}>Dismiss</button></div>}
      {isSuperAdmin && <div className="max-w-[340px]"><label className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground" htmlFor="onboarding-customer">Customer organization</label><select id="onboarding-customer" className={selectClass} value={org} onChange={(event) => { setOrg(event.target.value); setPreview([]); setResults([]); }}><option value="">Select customer</option>{orgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}

      <div className="max-w-[420px]"><label className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground" htmlFor="onboarding-product">Product</label><select id="onboarding-product" className={selectClass} value={selectedProduct?.id || productID} onChange={(event) => { setProductID(event.target.value); setPreview([]); setResults([]); }}><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.code})</option>)}</select>{selectedProduct && <p className="mt-1.5 text-[11px] text-muted-foreground">Serial number is always required. {selectedProduct.identity_schema.length ? `Additional identity: ${selectedProduct.identity_schema.map((rule) => rule.label || rule.kind).join(", ")}.` : "No secondary identifier is required."}</p>}</div>

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:grid-cols-4"><Kpi label="Awaiting device" value={awaiting.length} note="Pre-registered identities" tone="warn" /><Kpi label="Available to claim" value={pending.length} note="Connected, not assigned" tone="ok" /><Kpi label="Claim requests" value={claimRequests.length} note="Workflow not exposed by API" /><Kpi label="Rejected" value={rejected.length} note="Canceled registrations" /></div>

      <Card>
        <CardHeader className="border-b border-border"><CardTitle>Add devices</CardTitle><CardDescription>Choose the onboarding method that matches how the routers are being prepared.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <button type="button" onClick={() => setAddMode("manual")} className={`rounded-lg border p-4 text-left transition-colors ${addMode === "manual" ? "border-primary bg-accent/50" : "border-border hover:bg-secondary/40"}`}><Plus className="size-4 text-primary" /><span className="mt-3 block text-[13px] font-semibold">Register identities</span><span className="mt-1 block text-xs text-muted-foreground">Enter serial numbers and LAN MAC addresses.</span></button>
          <button type="button" onClick={() => setAddMode("csv")} className={`rounded-lg border p-4 text-left transition-colors ${addMode === "csv" ? "border-primary bg-accent/50" : "border-border hover:bg-secondary/40"}`}><FileUp className="size-4 text-primary" /><span className="mt-3 block text-[13px] font-semibold">Import a CSV</span><span className="mt-1 block text-xs text-muted-foreground">Validate up to 500 device identities before submission.</span></button>
          {isSuperAdmin && <button type="button" onClick={() => setAddMode("token")} className={`rounded-lg border p-4 text-left transition-colors ${addMode === "token" ? "border-primary bg-accent/50" : "border-border hover:bg-secondary/40"}`}><KeyRound className="size-4 text-primary" /><span className="mt-3 block text-[13px] font-semibold">Enrollment token</span><span className="mt-1 block text-xs text-muted-foreground">Generate or revoke router enrollment credentials.</span></button>}
        </CardContent>
      </Card>

      {addMode === "manual" && <Card><CardHeader className="border-b border-border"><CardTitle>Register device identities</CardTitle><CardDescription>These records are matched when a router checks in for the first time. Serial number is always required; the product identity field is optional only when the product schema allows it.</CardDescription></CardHeader><CardContent className="p-4"><div className="hidden grid-cols-[1fr_1fr_1fr_1fr_32px] gap-3 border-b border-border pb-2 text-[10.5px] font-semibold uppercase text-muted-foreground lg:grid"><span>Name</span><span>Serial number</span><span>{primaryRule?.label || primaryRule?.kind || "Secondary identifier"}</span><span>Tags</span><span /></div><div className="divide-y divide-border">{rows.map((row, index) => <div key={index} className="grid gap-2.5 py-3 lg:grid-cols-[1fr_1fr_1fr_1fr_32px] lg:items-center lg:gap-3"><Input aria-label={`Device name ${index + 1}`} placeholder="Name (optional)" value={row.name} onChange={(event) => updateEntry(index, "name", event.target.value)} /><Input aria-label={`Serial number ${index + 1}`} placeholder="Serial number" value={row.serial_number} className="font-mono text-[11px]" onChange={(event) => updateEntry(index, "serial_number", event.target.value)} /><Input aria-label={`${primaryRule?.label || primaryRule?.kind || "Secondary identifier"} ${index + 1}`} placeholder={primaryRule?.normalize === "mac" ? "AA:BB:CC:DD:EE:FF" : primaryRule?.label || primaryRule?.kind || "Optional"} value={row.lan_mac} className="font-mono text-[11px]" onChange={(event) => updateEntry(index, "lan_mac", event.target.value)} /><Input aria-label={`Tags ${index + 1}`} list="onboarding-tags" placeholder="tag-a, tag-b" value={row.tags.join(", ")} onChange={(event) => updateEntry(index, "tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /><Button variant="ghost" size="icon" aria-label={`Remove row ${index + 1}`} onClick={() => setRows((current) => current.length === 1 ? [blank()] : current.filter((_, rowIndex) => rowIndex !== index))} disabled={busy}><Trash2 className="size-4 text-destructive" /></Button></div>)}</div><datalist id="onboarding-tags">{availableTags.map((tag) => <option key={tag} value={tag} />)}</datalist><div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => setRows((current) => [...current, blank()])} disabled={rows.length >= 500 || busy}><Plus className="size-3.5" />Add row</Button><Button onClick={() => void submit(rows)} disabled={busy || !org || !selectedProduct}>Register devices</Button></div></CardContent></Card>}

      {addMode === "csv" && <Card><CardHeader className="border-b border-border"><CardTitle>Import device identities</CardTitle><CardDescription>Expected columns: name, serial_number, {selectedProduct?.identity_schema.map((rule) => rule.kind).join(", ") || "tags"}, tags. Separate tags with commas.</CardDescription></CardHeader><CardContent className="space-y-4 p-4"><a download="xnet-rms-devices.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(["name", "serial_number", ...(selectedProduct?.identity_schema.map((rule) => rule.kind) || []), "tags"].join(",") + "\n")}`}><Button variant="outline" asChild><span><FileUp className="size-3.5" />Download template</span></Button></a><label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-8 text-center hover:border-primary/50"><FileUp className="size-6 text-primary" /><span className="text-[13px] font-medium">Choose a CSV file</span><span className="text-xs text-muted-foreground">Maximum 500 rows and 1 MiB</span><input aria-label="Device CSV" type="file" accept=".csv,text/csv" className="sr-only" disabled={!org || !selectedProduct || busy} onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; setPreview([]); if (file) void run(async () => { if (file.size > 1048576) throw new Error("Maximum file size is 1 MiB"); setPreview(await request<any[]>(`registrations/preview?organization_id=${encodeURIComponent(org)}&product_id=${encodeURIComponent(selectedProduct?.id || "")}`, "POST", await file.text(), true)); }); event.target.value = ""; }} /></label>{preview.length > 0 && <><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-semibold">Validation preview <span className="font-mono text-xs text-muted-foreground">({preview.filter((item) => item.valid).length} valid / {preview.length} total)</span></span><Button onClick={() => void submit(preview.filter((item) => item.valid).map((item) => item.data))} disabled={!preview.some((item) => item.valid) || busy}>Register valid rows</Button></div><div className="overflow-x-auto rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Serial</TableHead><TableHead>Identifiers</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{preview.map((item) => <TableRow key={item.row}><TableCell className="font-mono text-[11px]">{item.row}</TableCell><TableCell className="font-mono text-[11px]">{item.data?.serial_number}</TableCell><TableCell className="font-mono text-[11px]">{identifierText(item.data?.identifiers, item.data?.lan_mac)}</TableCell><TableCell><Badge variant={item.valid ? "ok" : "down"}>{item.valid ? <><Check className="size-3" />Valid</> : item.error || "Invalid"}</Badge></TableCell></TableRow>)}</TableBody></Table></div></>}</CardContent></Card>}

      {isSuperAdmin && addMode === "token" && <Card><CardHeader className="border-b border-border"><CardTitle>Enrollment credentials</CardTitle><CardDescription>Tokens are shown once at creation time. Revoke a token to stop future auto-enrollment.</CardDescription></CardHeader><CardContent className="space-y-5 p-4"><div className="grid gap-3 md:grid-cols-[1fr_180px_auto]"><Input aria-label="Token name" placeholder="Token name or purpose" value={tokenForm.name} onChange={(event) => setTokenForm((current) => ({ ...current, name: event.target.value }))} /><Input aria-label="Maximum token uses" type="number" min={1} max={10000} value={tokenForm.max_uses} onChange={(event) => setTokenForm((current) => ({ ...current, max_uses: Number(event.target.value) || 1 }))} /><Button onClick={() => void createToken()} disabled={busy || !org}><KeyRound className="size-3.5" />Generate token</Button></div><div><div className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">Default groups</div><div className="flex flex-wrap gap-2">{scopedGroups.length ? scopedGroups.map((group) => <label key={group.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px]"><input type="checkbox" checked={tokenForm.group_ids.includes(group.id)} onChange={(event) => setTokenForm((current) => ({ ...current, group_ids: event.target.checked ? [...current.group_ids, group.id] : current.group_ids.filter((id) => id !== group.id) }))} />{group.name}</label>) : <span className="text-xs text-muted-foreground">No groups configured for this customer.</span>}</div></div><div className="overflow-x-auto rounded-lg border border-border"><Table><TableHeader><TableRow><TableHead>Purpose</TableHead><TableHead>Uses</TableHead><TableHead>State</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{tokens.map((token) => <TableRow key={token.id}><TableCell><div className="text-[13px] font-medium">{token.name}</div><div className="font-mono text-[10px] text-muted-foreground">{token.id}</div></TableCell><TableCell className="font-mono text-[11px] tabular-nums">{token.used_count} / {token.max_uses ?? "∞"}</TableCell><TableCell><Badge variant={token.revoked ? "down" : "ok"}>{token.revoked ? "Revoked" : "Active"}</Badge></TableCell><TableCell className="text-right"><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={token.revoked} onClick={() => setRevokeTarget(token)}><X className="size-3.5" />Revoke</Button></TableCell></TableRow>)}{!tokens.length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-xs text-muted-foreground">No enrollment tokens in this scope.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>}

      {!!results.length && <Card><CardHeader className="border-b border-border"><CardTitle>Latest submission</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Result</TableHead></TableRow></TableHeader><TableBody>{results.map((item, index) => <TableRow key={index}><TableCell className="font-mono text-[11px]">{item.row ?? index + 1}</TableCell><TableCell><Badge variant={item.success ? "ok" : "down"}>{item.success ? "Registered" : item.error || "Failed"}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}

      <Card><CardHeader className="border-b border-border"><CardTitle>Onboarding queue</CardTitle><CardDescription>Registration state is separate from connected-device ownership.</CardDescription></CardHeader><CardContent className="p-0"><Tabs value={queueTab} onValueChange={(value) => setQueueTab(value as QueueTab)}><TabsList className="w-full flex-wrap justify-start px-4 pt-2"><TabsTrigger value="awaiting">Awaiting device <span className="font-mono text-[10px]">{awaiting.length}</span></TabsTrigger><TabsTrigger value="available">Available to claim <span className="font-mono text-[10px]">{pending.length}</span></TabsTrigger><TabsTrigger value="claims">Claim requests <span className="font-mono text-[10px]">{claimRequests.length}</span></TabsTrigger><TabsTrigger value="rejected">Rejected <span className="font-mono text-[10px]">{rejected.length}</span></TabsTrigger></TabsList>
        <TabsContent value="awaiting" className="mt-0"><QueueTable loading={busy} rows={awaiting} kind="awaiting" onEdit={(row) => startEdit(row, false)} onCancel={(row) => setCancelTarget(row)} /></TabsContent>
        <TabsContent value="available" className="mt-0"><Table><TableHeader><TableRow><TableHead>Device identity</TableHead><TableHead>Model</TableHead><TableHead>Last seen</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{pending.map((item) => <TableRow key={item.id}><TableCell><div className="flex items-center gap-2.5"><span className="grid size-7 place-items-center rounded-md bg-accent text-accent-foreground"><Router className="size-3.5" /></span><span><span className="block font-mono text-[11px] font-semibold">{item.serial_number}</span><span className="block font-mono text-[10px] text-muted-foreground">{identifierText(item.identifiers, item.lan_mac)}</span></span></div></TableCell><TableCell className="text-[12px]">{item.model || "Niseva router"}</TableCell><TableCell className="font-mono text-[10.5px] text-muted-foreground">{dateLabel(item.last_seen)}</TableCell><TableCell className="text-right"><Button size="sm" onClick={() => startEdit(item, true)}>Claim device</Button></TableCell></TableRow>)}{!pending.length && <TableRow><TableCell colSpan={4} className="h-28 text-center text-xs text-muted-foreground">No devices are available to claim.</TableCell></TableRow>}</TableBody></Table></TabsContent>
        <TabsContent value="claims" className="mt-0"><div className="flex min-h-32 flex-col items-center justify-center gap-2 p-6 text-center"><ShieldCheck className="size-5 text-muted-foreground/60" /><p className="text-[13px] font-medium">Claim requests are not available</p><p className="max-w-md text-xs text-muted-foreground text-pretty">The current backend supports direct claiming of available devices, but does not expose a separate request, approval, or denial workflow.</p></div></TabsContent>
        <TabsContent value="rejected" className="mt-0"><QueueTable loading={busy} rows={rejected} kind="rejected" /></TabsContent>
      </Tabs></CardContent></Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}><DialogContent><DialogHeader><DialogTitle>{editing?.claim ? "Claim device" : "Edit registration"}</DialogTitle><DialogDescription>Set a friendly name and optional customer tags.</DialogDescription></DialogHeader><div className="space-y-4"><Input aria-label="Device name" placeholder="Name (optional)" value={editName} onChange={(event) => setEditName(event.target.value)} /><Input aria-label="Device tags" list="edit-onboarding-tags" placeholder="Comma-separated tags" value={editTags.join(", ")} onChange={(event) => setEditTags(event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /><datalist id="edit-onboarding-tags">{availableTags.map((tag) => <option key={tag} value={tag} />)}</datalist></div><DialogFooter><Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={busy}>{busy ? "Saving…" : editing?.claim ? "Claim device" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!createdToken} onOpenChange={(open) => !open && setCreatedToken(null)}><DialogContent><DialogHeader><DialogTitle>Copy enrollment token</DialogTitle><DialogDescription>This value will not be shown again after closing this dialog.</DialogDescription></DialogHeader><div className="rounded-lg border border-warn-border bg-warn-bg p-3"><code className="block break-all font-mono text-[11px] text-warn">{createdToken}</code></div><DialogFooter><Button variant="outline" onClick={() => { if (createdToken) void navigator.clipboard?.writeText(createdToken); toast.success("Token copied"); }}>Copy token</Button><Button onClick={() => setCreatedToken(null)}>Done</Button></DialogFooter></DialogContent></Dialog>
      <ConfirmDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)} title="Cancel this registration?" description={cancelTarget ? `Pre-registration for ${cancelTarget.serial_number} will be removed.` : "This pre-registration will be removed."} confirmLabel="Cancel registration" onConfirm={cancelRegistration} />
      <ConfirmDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)} title="Revoke enrollment token?" description="Routers using this token will no longer be allowed to auto-enroll." confirmLabel="Revoke token" onConfirm={revokeToken} />
    </div>
  );
}

function QueueTable({ loading, rows, kind, onEdit, onCancel }: { loading: boolean; rows: Registration[]; kind: "awaiting" | "rejected"; onEdit?: (row: Registration) => void; onCancel?: (row: Registration) => void }) {
  return <Table><TableHeader><TableRow><TableHead>Device identity</TableHead><TableHead>Tags</TableHead><TableHead>{kind === "rejected" ? "Canceled" : "Created"}</TableHead><TableHead>State</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.id}><TableCell><div className="text-[13px] font-medium">{item.name || "Unnamed device"}</div><div className="mt-1 font-mono text-[10.5px] text-muted-foreground">{item.serial_number} · {identifierText(item.identifiers, item.lan_mac)}</div></TableCell><TableCell><div className="flex flex-wrap gap-1">{item.tags?.length ? item.tags.map((tag) => <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>) : <span className="text-xs text-muted-foreground">No tags</span>}</div></TableCell><TableCell className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">{dateLabel(item.created_at)}</TableCell><TableCell><Badge variant={kind === "rejected" ? "neutral" : "warn"}>{kind === "rejected" ? "Rejected" : "Awaiting device"}</Badge></TableCell><TableCell className="text-right">{kind === "awaiting" && <div className="flex justify-end gap-1.5"><Button variant="outline" size="sm" onClick={() => onEdit?.(item)}>Edit</Button><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onCancel?.(item)}>Cancel</Button></div>}</TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-xs text-muted-foreground">{loading ? "Loading…" : kind === "rejected" ? "No rejected registrations." : "No devices are awaiting first check-in."}</TableCell></TableRow>}</TableBody></Table>;
}
