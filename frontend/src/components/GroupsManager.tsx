import React, { useEffect, useState } from "react";
import { Edit3, Plus, RefreshCw, Settings2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Device, DeviceGroup, Organization, User } from "../types";
import { api, formatApiError } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Props { user: User; organizations: Organization[]; selectedOrg: string; groups: DeviceGroup[]; devices: Device[]; onRefresh: () => void; }
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

export default function GroupsManager({ user, organizations, selectedOrg, groups, devices, onRefresh }: Props) {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const canEdit = isSuperAdmin || user.role === "ORG_ADMIN";
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceGroup | null>(null);
  const [managing, setManaging] = useState<DeviceGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceGroup | null>(null);
  const [targetOrg, setTargetOrg] = useState(selectedOrg || user.organization_id || "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (selectedOrg) setTargetOrg(selectedOrg); }, [selectedOrg]);
  const visibleGroups = groups.filter((group) => !targetOrg || group.organization_id === targetOrg);
  const visibleDevices = devices.filter((device) => !targetOrg || device.organization_id === targetOrg);
  const openCreate = () => { setEditing(null); setName(""); setDescription(""); setModalOpen(true); };
  const openEdit = (group: DeviceGroup) => { setEditing(group); setName(group.name); setDescription(group.description || ""); setModalOpen(true); };
  const save = async () => {
    if (!name.trim() || (isSuperAdmin && !targetOrg)) { toast.warning("Organization and group name are required."); return; }
    setBusy(true);
    try { const payload = { name: name.trim(), description: description.trim(), organization_id: targetOrg }; if (editing) await api(`groups/${editing.id}`, "PATCH", payload); else await api("groups", "POST", payload); toast.success(editing ? "Group updated" : "Group created"); setModalOpen(false); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    try { await api(`groups/${deleteTarget.id}`, "DELETE"); toast.success("Group deleted"); setDeleteTarget(null); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); }
  };
  const openManage = async (group: DeviceGroup) => {
    setManaging(group); setBusy(true);
    try { const members = await api<Device[]>(`groups/${group.id}/devices`); setSelectedDevices((members || []).map((device) => device.id)); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setBusy(false); }
  };
  const updateMembers = async (ids: string[]) => {
    if (!managing) return;
    const before = new Set(selectedDevices); const after = new Set(ids); setSelectedDevices(ids); setBusy(true);
    try { await Promise.all([...ids.filter((id) => !before.has(id)).map((id) => api(`groups/${managing.id}/devices/${id}`, "PUT")), ...selectedDevices.filter((id) => !after.has(id)).map((id) => api(`groups/${managing.id}/devices/${id}`, "DELETE"))]); toast.success("Group membership updated"); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setBusy(false); }
  };

  return <div className="mx-auto flex max-w-[1100px] flex-col gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-[20px] font-semibold">Device groups</h1><p className="mt-1 text-[13px] text-muted-foreground">Organize routers into reusable operational groups.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw className="size-3.5" />Refresh</Button>{canEdit && <Button size="sm" onClick={openCreate}><Plus className="size-4" />Create group</Button>}</div></div>
    {isSuperAdmin && <div className="max-w-[300px]"><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer scope</label><select aria-label="Organization" value={targetOrg} onChange={(event) => setTargetOrg(event.target.value)} className={selectClass}><option value="">Select organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div>}
    <Card><CardHeader className="border-b border-border"><CardTitle>Groups</CardTitle><CardDescription>{visibleGroups.length} group{visibleGroups.length === 1 ? "" : "s"} in the selected scope.</CardDescription></CardHeader><CardContent className="p-0">{visibleGroups.length ? <div className="divide-y divide-border">{visibleGroups.map((group) => <div key={group.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5"><div className="grid size-8 shrink-0 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><Users className="size-4" /></div><div className="min-w-[180px] flex-1"><div className="text-[13px] font-semibold">{group.name}</div><div className="mt-1 text-xs text-muted-foreground">{group.description || "No description"}</div></div><Badge variant="secondary" className="font-mono font-normal">{group.device_count} devices</Badge>{canEdit && <div className="flex gap-1.5"><Button variant="outline" size="sm" onClick={() => void openManage(group)}><Settings2 className="size-3.5" />Manage</Button><Button variant="outline" size="icon" className="size-8" aria-label={`Edit ${group.name}`} onClick={() => openEdit(group)}><Edit3 className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-8 text-destructive hover:text-destructive" aria-label={`Delete ${group.name}`} onClick={() => setDeleteTarget(group)}><Trash2 className="size-3.5" /></Button></div>}</div>)}</div> : <div className="flex min-h-36 flex-col items-center justify-center gap-1 p-6 text-center"><Users className="mb-1 size-5 text-muted-foreground/50" /><p className="text-[13px] font-medium">No groups for this organization</p><p className="text-xs text-muted-foreground">Create a group to organize your routers.</p></div>}</CardContent></Card>
    <Dialog open={modalOpen} onOpenChange={setModalOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Edit device group" : "Create device group"}</DialogTitle><DialogDescription>Give this group a clear name and optional operational description.</DialogDescription></DialogHeader><div className="space-y-4">{isSuperAdmin && <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target organization</label><select value={targetOrg} onChange={(event) => setTargetOrg(event.target.value)} className={selectClass}><option value="">Select organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div>}<div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Name</label><Input value={name} maxLength={128} onChange={(event) => setName(event.target.value)} /></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Description</label><textarea value={description} maxLength={512} onChange={(event) => setDescription(event.target.value)} className="min-h-24 w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25" /></div></div><DialogFooter><Button variant="outline" onClick={() => setModalOpen(false)} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create group"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!managing} onOpenChange={(open) => !open && setManaging(null)}><DialogContent><DialogHeader><DialogTitle>Devices in {managing?.name}</DialogTitle><DialogDescription>Select the routers that should belong to this group. Changes save as you select.</DialogDescription></DialogHeader><div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">{visibleDevices.length ? visibleDevices.map((device) => <label key={device.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-0 hover:bg-secondary/50"><input type="checkbox" checked={selectedDevices.includes(device.id)} disabled={busy} onChange={(event) => void updateMembers(event.target.checked ? [...selectedDevices, device.id] : selectedDevices.filter((id) => id !== device.id))} className="size-4 accent-primary" /><span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium">{device.name || device.serial_number}</span><span className="block font-mono text-[10.5px] text-muted-foreground">{device.serial_number}</span></span></label>) : <p className="p-6 text-center text-xs text-muted-foreground">No devices in this organization.</p>}</div><DialogFooter><Button variant="outline" onClick={() => setManaging(null)}>Done</Button></DialogFooter></DialogContent></Dialog>
    <ConfirmDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} title={`Delete ${deleteTarget?.name || "this group"}?`} description="Devices remain enrolled; only their membership in this group is removed." confirmLabel="Delete group" onConfirm={remove} />
  </div>;
}
