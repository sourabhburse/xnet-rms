import React, { useEffect, useState } from "react";
import { Hash, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Organization, TagItem, User } from "../types";
import { api, formatApiError } from "../api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface TagsManagerProps { user: User; tags: TagItem[]; organizations: Organization[]; selectedOrg: string; loading: boolean; onRefresh: () => void; }
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

export default function TagsManager({ user, tags, organizations, selectedOrg, loading, onRefresh }: TagsManagerProps) {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const [modalOpen, setModalOpen] = useState(false);
  const [tagName, setTagName] = useState("");
  const [targetOrg, setTargetOrg] = useState(selectedOrg || user.organization_id || "");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (selectedOrg) setTargetOrg(selectedOrg); }, [selectedOrg]);
  const filteredTags = (tags || []).filter((tag) => !selectedOrg || tag.organization_id === selectedOrg);
  const handleCreateTag = async () => {
    if (!tagName.trim()) { toast.warning("Tag name cannot be empty."); return; }
    if (!targetOrg) { toast.warning("Please select an organization."); return; }
    setSubmitting(true);
    try { await api("tags", "POST", { name: tagName.trim(), organization_id: targetOrg }); toast.success(`Tag "${tagName.trim()}" created successfully!`); setTagName(""); setModalOpen(false); onRefresh(); }
    catch (err) { toast.error(formatApiError(err).message); } finally { setSubmitting(false); }
  };

  return <div className="mx-auto flex max-w-[1000px] flex-col gap-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-[20px] font-semibold">Customer tags</h1><p className="mt-1 text-[13px] text-muted-foreground">Categorize routers by location, department, or deployment type.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />Refresh</Button><Button size="sm" onClick={() => setModalOpen(true)}><Plus className="size-4" />Create tag</Button></div></div>
    <Card><CardHeader className="border-b border-border"><CardTitle>Tag library</CardTitle><CardDescription>{filteredTags.length} customer-scoped tag{filteredTags.length === 1 ? "" : "s"} in the current scope.</CardDescription></CardHeader><CardContent className="p-0">{filteredTags.length ? <div className="divide-y divide-border">{filteredTags.map((tag) => { const organization = organizations.find((item) => item.id === tag.organization_id); return <div key={tag.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5"><span className="grid size-8 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground"><Hash className="size-4" /></span><Badge variant="accent" className="text-[12px] font-medium">{tag.name}</Badge><span className="text-[12px] text-muted-foreground">{organization?.name || tag.organization_id}</span><span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{tag.id}</span></div>; })}</div> : <div className="flex min-h-36 flex-col items-center justify-center gap-1 p-6 text-center"><Hash className="mb-1 size-5 text-muted-foreground/50" /><p className="text-[13px] font-medium">No tags in this scope</p><p className="text-xs text-muted-foreground">Create a tag to start organizing devices.</p></div>}</CardContent></Card>
    <Dialog open={modalOpen} onOpenChange={setModalOpen}><DialogContent><DialogHeader><DialogTitle>Create customer tag</DialogTitle><DialogDescription>Tags are scoped to one customer organization and can be assigned during onboarding.</DialogDescription></DialogHeader><div className="space-y-4">{isSuperAdmin && <div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target customer organization</label><select value={targetOrg} onChange={(event) => setTargetOrg(event.target.value)} className={selectClass}><option value="">Select organization</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></div>}<div><label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tag name</label><Input autoFocus placeholder="e.g. warehouse-ny, retail" value={tagName} maxLength={64} onChange={(event) => setTagName(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setModalOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={handleCreateTag} disabled={submitting}>{submitting ? "Creating…" : "Create tag"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
