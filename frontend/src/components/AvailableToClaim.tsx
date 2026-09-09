import React, { useState } from "react";
import { CheckCircle2, RefreshCw, Router } from "lucide-react";
import { toast } from "sonner";

import { PendingDevice, TagItem, User } from "../types";
import { api, formatApiError } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AvailableToClaimProps {
  user: User;
  pendingDevices: PendingDevice[];
  loading: boolean;
  tags: TagItem[];
  selectedOrg: string;
  onRefresh: () => void;
}

export default function AvailableToClaim({ pendingDevices, loading, tags, selectedOrg, onRefresh }: AvailableToClaimProps) {
  const [claimingDevice, setClaimingDevice] = useState<PendingDevice | null>(null);
  const [claimName, setClaimName] = useState("");
  const [claimTags, setClaimTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const filteredDevices = (pendingDevices || []).filter((device) => !selectedOrg || device.organization_id === selectedOrg);
  const availableTags = (tags || []).filter((tag) => !claimingDevice || !claimingDevice.organization_id || tag.organization_id === claimingDevice.organization_id).map((tag) => tag.name);

  const openClaim = (device: PendingDevice) => { setClaimingDevice(device); setClaimName(""); setClaimTags([]); };
  const closeClaim = () => { if (!submitting) setClaimingDevice(null); };
  const handleClaimSubmit = async () => {
    if (!claimingDevice) return;
    setSubmitting(true);
    try {
      await api(`pending-devices/${claimingDevice.id}/claim`, "POST", { name: claimName.trim(), tags: claimTags });
      toast.success(`Device ${claimingDevice.serial_number} claimed successfully!`);
      setClaimingDevice(null); onRefresh();
    } catch (err) { toast.error(formatApiError(err).message); } finally { setSubmitting(false); }
  };

  return <div className="mx-auto flex max-w-[1200px] flex-col gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-[20px] font-semibold">Unclaimed devices</h1><p className="mt-1 text-[13px] text-muted-foreground">Routers waiting to be claimed into your customer workspace.</p></div><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button></div>
    <Card><CardHeader className="border-b border-border"><CardTitle>Available to claim</CardTitle><CardDescription>Connected devices discovered through an enrollment token or factory challenge.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Device identity</TableHead><TableHead>Model</TableHead><TableHead>Status</TableHead><TableHead>Last active</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-xs text-muted-foreground">Loading devices…</TableCell></TableRow> : filteredDevices.length ? filteredDevices.map((device) => <TableRow key={device.id}><TableCell><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><Router className="size-4" /></span><div><div className="font-mono text-[11px] font-semibold text-foreground">{device.serial_number}</div><div className="mt-1 font-mono text-[10.5px] text-muted-foreground">{device.lan_mac}</div></div></div></TableCell><TableCell className="text-[12.5px]">{device.model || "Niseva router"}</TableCell><TableCell><Badge variant="warn"><span className="size-1.5 rounded-full bg-current" />Available to claim</Badge></TableCell><TableCell className="font-mono text-[10.5px] text-muted-foreground">{device.last_seen ? new Date(device.last_seen).toLocaleString() : "—"}</TableCell><TableCell className="text-right"><Button size="sm" onClick={() => openClaim(device)}><CheckCircle2 className="size-3.5" />Claim device</Button></TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="h-36 text-center"><div className="flex flex-col items-center gap-1"><Router className="mb-1 size-5 text-muted-foreground/50" /><p className="text-[13px] font-medium">No devices awaiting claim</p><p className="text-xs text-muted-foreground">Connected devices will appear here when ready.</p></div></TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    <Dialog open={!!claimingDevice} onOpenChange={(open) => !open && closeClaim()}><DialogContent><DialogHeader><DialogTitle>Claim router{claimingDevice ? ` · ${claimingDevice.serial_number}` : ""}</DialogTitle><DialogDescription>Assign an optional friendly name and customer tags before enrolling this router into your workspace.</DialogDescription></DialogHeader><div className="space-y-4"><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Device friendly name</label><Input placeholder="e.g. Branch office router" value={claimName} maxLength={128} onChange={(event) => setClaimName(event.target.value)} /></div><div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customer tags</label><Input list="claim-tags" placeholder="Comma-separated tags" value={claimTags.join(", ")} onChange={(event) => setClaimTags(event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} /><datalist id="claim-tags">{availableTags.map((tag) => <option key={tag} value={tag} />)}</datalist><p className="mt-1.5 text-[11px] text-muted-foreground">Use commas to add multiple tags.</p></div></div><DialogFooter><Button variant="outline" onClick={closeClaim} disabled={submitting}>Cancel</Button><Button onClick={handleClaimSubmit} disabled={submitting}>{submitting ? "Claiming…" : "Confirm & claim"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
