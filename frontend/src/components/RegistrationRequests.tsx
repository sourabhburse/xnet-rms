import React, { useState } from "react";
import { Edit3, RefreshCw, Trash2, Router } from "lucide-react";
import { toast } from "sonner";

import { Registration, TagItem, User } from "../types";
import { api, formatApiError } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface RegistrationRequestsProps {
  user: User;
  registrations: Registration[];
  loading: boolean;
  tags: TagItem[];
  selectedOrg: string;
  onRefresh: () => void;
}

export default function RegistrationRequests({ registrations, loading, tags, selectedOrg, onRefresh }: RegistrationRequestsProps) {
  const [editingItem, setEditingItem] = useState<Registration | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [cancelItem, setCancelItem] = useState<Registration | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const filteredRegistrations = (registrations || []).filter((registration) => !selectedOrg || registration.organization_id === selectedOrg);
  const availableTags = (tags || []).filter((tag) => !editingItem || !editingItem.organization_id || tag.organization_id === editingItem.organization_id).map((tag) => tag.name);

  const openEdit = (item: Registration) => { setEditingItem(item); setEditName(item.name || ""); setEditTags(item.tags || []); };
  const handleEditSubmit = async () => {
    if (!editingItem) return;
    setSubmitting(true);
    try { await api(`registrations/${editingItem.id}`, "PATCH", { name: editName.trim(), tags: editTags }); toast.success("Registration updated successfully"); setEditingItem(null); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setSubmitting(false); }
  };
  const cancelRegistration = async () => {
    if (!cancelItem) return;
    try { await api(`registrations/${cancelItem.id}`, "DELETE"); toast.success("Registration cancelled"); setCancelItem(null); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); }
  };

  return <div className="mx-auto flex max-w-[1200px] flex-col gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-[20px] font-semibold">Awaiting device connection</h1><p className="mt-1 text-[13px] text-muted-foreground">Pre-registered routers that have not completed their first boot check-in.</p></div><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button></div>
    <Card><CardHeader className="border-b border-border"><CardTitle>Registration requests</CardTitle><CardDescription>Review, update, or cancel pending pre-registration records.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Device identity</TableHead><TableHead>Tags</TableHead><TableHead>State</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-xs text-muted-foreground">Loading requests…</TableCell></TableRow> : filteredRegistrations.length ? filteredRegistrations.map((registration) => <TableRow key={registration.id}><TableCell><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><Router className="size-4" /></span><div><div className="font-mono text-[11px] font-semibold">{registration.serial_number}</div><div className="mt-1 text-[12px] text-muted-foreground">{registration.name || "Unnamed device"} · <span className="font-mono text-[10.5px]">{registration.lan_mac}</span></div></div></div></TableCell><TableCell><div className="flex max-w-[180px] flex-wrap gap-1">{registration.tags?.length ? registration.tags.map((tag) => <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>) : <span className="text-xs text-muted-foreground">None</span>}</div></TableCell><TableCell><Badge variant={registration.status === "awaiting_device" ? "warn" : registration.status === "claimed" ? "ok" : "neutral"}><span className="size-1.5 rounded-full bg-current" />{registration.status === "awaiting_device" ? "Awaiting device" : registration.status === "claimed" ? "Claimed / enrolled" : "Canceled"}</Badge></TableCell><TableCell className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground">{registration.created_at ? new Date(registration.created_at).toLocaleString() : "—"}</TableCell><TableCell className="text-right">{registration.status === "awaiting_device" && <div className="flex justify-end gap-1.5"><Button variant="outline" size="sm" onClick={() => openEdit(registration)}><Edit3 className="size-3.5" />Edit</Button><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setCancelItem(registration)}><Trash2 className="size-3.5" />Cancel</Button></div>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-36 text-center"><div className="flex flex-col items-center gap-1"><Router className="mb-1 size-5 text-muted-foreground/50" /><p className="text-[13px] font-medium">No active registration requests</p><p className="text-xs text-muted-foreground">New pre-registrations will appear here.</p></div></TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}><DialogContent><DialogHeader><DialogTitle>Edit registration{editingItem ? ` · ${editingItem.serial_number}` : ""}</DialogTitle><DialogDescription>Update the friendly name or customer tags before the router connects.</DialogDescription></DialogHeader><div className="space-y-4"><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Device friendly name</label><Input value={editName} maxLength={128} onChange={(event) => setEditName(event.target.value)} /></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer tags</label><Input list="registration-tags" value={editTags.join(", ")} onChange={(event) => setEditTags(event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /><datalist id="registration-tags">{availableTags.map((tag) => <option key={tag} value={tag} />)}</datalist><p className="mt-1.5 text-[11px] text-muted-foreground">Use commas to add multiple tags.</p></div></div><DialogFooter><Button variant="outline" onClick={() => setEditingItem(null)} disabled={submitting}>Cancel</Button><Button onClick={handleEditSubmit} disabled={submitting}>{submitting ? "Saving…" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>
    <ConfirmDialog open={!!cancelItem} onOpenChange={(open) => !open && setCancelItem(null)} title="Cancel this registration?" description={cancelItem ? `Pre-registration for router ${cancelItem.serial_number} will be removed.` : "This pre-registration will be removed."} confirmLabel="Cancel registration" onConfirm={cancelRegistration} />
  </div>;
}
