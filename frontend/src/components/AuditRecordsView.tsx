import { useEffect, useMemo, useState } from "react";
import { Search, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { AuditRecord, Device, Organization, User } from "../types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AuditRecordsViewProps {
  data: AuditRecord[];
  organizations: Organization[];
  loading: boolean;
  onRefresh: () => void;
}

function actionTone(action: string) {
  const normalized = action.toLowerCase();
  if (normalized.includes("disable") || normalized.includes("revoke") || normalized.includes("delete")) return "text-down";
  if (normalized.includes("create") || normalized.includes("publish") || normalized.includes("claim")) return "text-ok";
  if (normalized.includes("session") || normalized.includes("login")) return "text-primary";
  if (normalized.includes("update") || normalized.includes("apply")) return "text-warn";
  return "text-muted-foreground";
}

export default function AuditRecordsView({ data, organizations, loading, onRefresh }: AuditRecordsViewProps) {
  const [records, setRecords] = useState<AuditRecord[]>(data || []);
  const [users, setUsers] = useState<User[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [selected, setSelected] = useState<AuditRecord | null>(null);

  useEffect(() => setRecords(data || []), [data]);
  useEffect(() => {
    Promise.all([
      api<User[]>("users"),
      api<{ items: Device[] }>("devices?page=1&q="),
    ]).then(([nextUsers, nextDevices]) => {
      setUsers(nextUsers || []);
      setDevices(nextDevices?.items || []);
    }).catch((err) => toast.error(formatApiError(err).message));
  }, []);

  const actions = useMemo(() => Array.from(new Set(records.map((record) => record.action))).sort(), [records]);
  const visibleRecords = useMemo(() => records.filter((record) => {
    const haystack = `${record.action} ${record.resource_id} ${record.user_id || "system"}`.toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (actionFilter === "all" || record.action === actionFilter);
  }), [records, query, actionFilter]);
  const resolveActor = (userId: string | null) => userId ? users.find((user) => user.id === userId)?.email || userId : "system";
  const resolveTarget = (resourceId: string) => devices.find((device) => device.id === resourceId)?.name || resourceId || "—";
  const organizationName = (organizationId: string) => organizations.find((organization) => organization.id === organizationId)?.name;

  return (
    <div className="-m-6 min-h-full bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5"><div className="flex items-start gap-3"><span className="grid size-9 place-items-center border border-accent bg-accent text-accent-foreground"><ScrollText className="size-4" /></span><div><h1 className="font-display text-[22px] font-semibold text-balance">Audit records</h1><p className="mt-1 max-w-2xl text-[13px] text-muted-foreground text-pretty">Review immutable administrator and system actions with resolved names where the API provides them.</p></div></div><Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>↻ Refresh</Button></header>
      <section><div className="border-b border-border px-6 py-4"><h2 className="text-[14px] font-semibold">Activity history</h2><p className="mt-1 text-[12px] text-muted-foreground">Filters are derived from the action strings returned by the server.</p></div><div className="flex flex-wrap gap-2 border-b border-border bg-secondary/20 px-6 py-3"><div className="relative min-w-[240px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search audit records" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, actor, or target…" className="h-9 pl-8" /></div><select aria-label="Filter by audit action" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="h-9 rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"><option value="all">All action families</option>{actions.map((action) => <option key={action} value={action}>{action}</option>)}</select><span className="self-center font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{visibleRecords.length} records</span></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Timestamp</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Target</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Details</TableHead></TableRow></TableHeader><TableBody>{visibleRecords.map((record) => <TableRow key={record.id}><TableCell className="whitespace-nowrap font-mono text-[10.5px] tabular-nums">{new Date(record.created_at).toLocaleString()}</TableCell><TableCell><span className={`font-mono text-[10px] uppercase tracking-[0.06em] ${actionTone(record.action)}`}>{record.action}</span></TableCell><TableCell><div className="max-w-[220px] truncate text-[12px]">{resolveActor(record.user_id)}</div>{record.user_id && <div className="font-mono text-[10px] text-muted-foreground">{record.user_id}</div>}</TableCell><TableCell><div className="max-w-[220px] truncate text-[12px]">{resolveTarget(record.resource_id)}</div><div className="font-mono text-[10px] text-muted-foreground">{record.resource_id || "—"}</div></TableCell><TableCell className="text-[12px]">{organizationName(record.organization_id) || record.organization_id || "—"}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setSelected(record)}>View raw</Button></TableCell></TableRow>)}{!visibleRecords.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-xs text-muted-foreground">{loading ? "Loading audit records…" : "No records match this filter."}</TableCell></TableRow>}</TableBody></Table></div></section>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-w-[680px]"><DialogHeader><DialogTitle>Audit record details</DialogTitle><DialogDescription>Raw identifiers and payload fields returned by the audit endpoint.</DialogDescription></DialogHeader><pre className="max-h-[55vh] overflow-auto rounded-lg border border-border bg-secondary/45 p-4 font-mono text-[11px] leading-5 text-foreground">{selected ? JSON.stringify(selected, null, 2) : ""}</pre></DialogContent></Dialog>
    </div>
  );
}
