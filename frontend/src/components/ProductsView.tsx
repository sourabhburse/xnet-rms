import { useEffect, useState } from "react";
import { Archive, Boxes, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { IdentityRule, Product, User } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ProductForm = { code: string; name: string; description: string; identity_schema: string; model_patterns: string; capabilities: string };

const blankForm = (): ProductForm => ({ code: "", name: "", description: "", identity_schema: "[]", model_patterns: "", capabilities: "" });
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

function formFromProduct(product?: Product): ProductForm {
  return product ? { code: product.code, name: product.name, description: product.description, identity_schema: JSON.stringify(product.identity_schema || [], null, 2), model_patterns: (product.model_patterns || []).join("\n"), capabilities: (product.capabilities || []).join("\n") } : blankForm();
}

export default function ProductsView({ currentUser, onRefresh }: { currentUser: User; onRefresh: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(blankForm());
  const [editing, setEditing] = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setProducts((await api<Product[]>("products")) || []); }
    catch (err) { toast.error(formatApiError(err).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openEditor = (product?: Product) => { setEditing(product || null); setForm(formFromProduct(product)); setOpen(true); };
  const save = async () => {
    let schema: IdentityRule[];
    try {
      const parsed = JSON.parse(form.identity_schema || "[]");
      if (!Array.isArray(parsed)) throw new Error("identity_schema must be an array");
      schema = parsed;
    } catch (err) { toast.error(err instanceof Error ? err.message : "Invalid identity schema JSON"); return; }
    const value = { code: form.code.trim(), name: form.name.trim(), description: form.description.trim(), identity_schema: schema, model_patterns: form.model_patterns.split("\n").map((value) => value.trim()).filter(Boolean), capabilities: form.capabilities.split("\n").map((value) => value.trim()).filter(Boolean) };
    setSaving(true);
    try { await api(editing ? `products/${editing.id}` : "products", editing ? "PATCH" : "POST", value); toast.success(editing ? "Product updated" : "Product created"); setOpen(false); await load(); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); }
    finally { setSaving(false); }
  };
  const archive = async () => {
    if (!archiveTarget) return;
    try { await api(`products/${archiveTarget.id}`, "DELETE"); toast.success("Product archived"); setArchiveTarget(null); await load(); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); }
  };

  if (currentUser.role !== "SUPER_ADMIN") return null;
  return <div className="mx-auto flex max-w-[1200px] flex-col gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><Boxes className="size-4" /></span><div><h1 className="font-display text-[20px] font-semibold">Products</h1><p className="mt-1 text-[13px] text-muted-foreground">Define product-specific identity fields and capabilities used during device enrollment.</p></div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button><Button size="sm" onClick={() => openEditor()}><Plus className="size-4" />Add product</Button></div></div>
    <Card><CardHeader className="border-b border-border"><CardTitle>Product catalog</CardTitle><CardDescription>Serial number is mandatory for every product. Add MAC, IMEI, or custom identifiers in the schema.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Identity schema</TableHead><TableHead>Model patterns</TableHead><TableHead>Revision</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{products.map((product) => <TableRow key={product.id}><TableCell><div className="font-medium">{product.name}</div><div className="font-mono text-[10px] text-muted-foreground">{product.code}</div></TableCell><TableCell><div className="flex flex-wrap gap-1">{product.identity_schema.length ? product.identity_schema.map((rule) => <Badge key={rule.kind} variant="secondary" className="font-normal">{rule.label || rule.kind}{rule.required ? " · required" : ""}</Badge>) : <span className="text-xs text-muted-foreground">Serial only</span>}</div></TableCell><TableCell className="max-w-[220px] truncate font-mono text-[11px]">{product.model_patterns.join(", ") || "Any model"}</TableCell><TableCell className="font-mono text-[11px]">v{product.current_revision}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1.5"><Button variant="outline" size="sm" onClick={() => openEditor(product)}><Pencil className="size-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setArchiveTarget(product)}><Archive className="size-3.5" />Archive</Button></div></TableCell></TableRow>)}{!products.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-xs text-muted-foreground">{loading ? "Loading products…" : "No active products configured."}</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-[720px]"><DialogHeader><DialogTitle>{editing ? "Edit product" : "Create product"}</DialogTitle><DialogDescription>Changing the schema creates a new immutable product revision. Existing devices retain their assigned revision.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Code</label><Input value={form.code} disabled={!!editing} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="gateway-x" /></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Name</label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Gateway X" /></div></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Description</label><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Identity schema JSON</label><textarea rows={8} value={form.identity_schema} onChange={(event) => setForm({ ...form, identity_schema: event.target.value })} className={`${selectClass} h-auto py-2 font-mono text-[11px]`} placeholder={'[{"kind":"imei","label":"IMEI","required":true,"normalize":"imei","unique":true} ]'} /><p className="mt-1 text-[11px] text-muted-foreground">Allowed normalizers: mac, imei, upper, raw. Serial is implicit.</p></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Model patterns</label><textarea rows={4} value={form.model_patterns} onChange={(event) => setForm({ ...form, model_patterns: event.target.value })} className={`${selectClass} h-auto py-2 font-mono text-[11px]`} placeholder="XE33 2S\n%gateway%" /></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Capabilities</label><textarea rows={4} value={form.capabilities} onChange={(event) => setForm({ ...form, capabilities: event.target.value })} className={`${selectClass} h-auto py-2 font-mono text-[11px]`} placeholder="modbus\ncellular" /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : editing ? "Save revision" : "Create product"}</Button></DialogFooter></DialogContent></Dialog>
    <ConfirmDialog open={!!archiveTarget} onOpenChange={(value) => !value && setArchiveTarget(null)} title="Archive this product?" description={archiveTarget ? `${archiveTarget.name} will no longer be offered for new enrollment.` : "The product will be archived."} confirmLabel="Archive product" onConfirm={archive} />
  </div>;
}
