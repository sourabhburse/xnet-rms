import { useEffect, useMemo, useState } from "react";
import { Building2, Copy, KeyRound, Pencil, Search, ShieldCheck, UserCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { api, formatApiError } from "../api";
import { EnrollmentToken, Organization, User } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface UsersAccessViewProps {
  initialTab?: "accounts" | "tokens" | "customers";
  currentUser: User;
  data: User[];
  organizations: Organization[];
  selectedOrg: string;
  loading: boolean;
  onRefresh: () => void;
}

const selectClass = "h-9 rounded-md border border-input bg-card px-3 text-[12px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";
const roleOptions: Array<{ value: User["role"]; label: string; description: string }> = [
  { value: "VIEWER", label: "Viewer", description: "Read-only fleet and telemetry access" },
  { value: "OPERATOR", label: "Operator", description: "Remote access and operational actions" },
  { value: "ORG_ADMIN", label: "Org admin", description: "Manage users, devices, and settings" },
];

function formatRole(role: User["role"]) {
  return role.replace("_", " ");
}

function ScopeSelect({ value, organizations, onChange }: { value: string; organizations: Organization[]; onChange: (value: string) => void }) {
  return (
    <select aria-label="Customer scope" value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
      <option value="">All customers</option>
      {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
    </select>
  );
}

export default function UsersAccessView({ initialTab = "accounts", currentUser, data, organizations, selectedOrg, loading, onRefresh }: UsersAccessViewProps) {
  const isSuperAdmin = currentUser.role === "SUPER_ADMIN";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [scope, setScope] = useState(selectedOrg);
  const [users, setUsers] = useState<User[]>(data || []);
  const [tokens, setTokens] = useState<EnrollmentToken[]>([]);
  const [customerList, setCustomerList] = useState<Organization[]>(organizations || []);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userOpen, setUserOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [disableTarget, setDisableTarget] = useState<User | null>(null);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<EnrollmentToken | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userForm, setUserForm] = useState({ email: "", password: "", role: "OPERATOR" as User["role"] });
  const [editForm, setEditForm] = useState({ email: "", password: "", role: "OPERATOR" as Exclude<User["role"], "SUPER_ADMIN">, organization_id: "" });
  const [tokenForm, setTokenForm] = useState({ name: "", maxUses: 1 });
  const [customerName, setCustomerName] = useState("");

  useEffect(() => setUsers(data || []), [data]);
  useEffect(() => setCustomerList(organizations || []), [organizations]);
  useEffect(() => setScope(selectedOrg), [selectedOrg]);

  const loadScopedData = async () => {
    const suffix = scope ? `?organization_id=${encodeURIComponent(scope)}` : "";
    try {
      const nextUsers = await api<User[]>(`users${suffix}`);
      const nextTokens = isSuperAdmin ? await api<EnrollmentToken[]>(`enrollment-tokens${suffix}`) : [];
      setUsers(nextUsers || []);
      setTokens(nextTokens || []);
      if (isSuperAdmin) {
        const nextOrganizations = await api<Organization[]>("organizations");
        setCustomerList(nextOrganizations || []);
      }
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  useEffect(() => { if (!isSuperAdmin && activeTab === "tokens") setActiveTab("accounts"); void loadScopedData(); }, [scope, isSuperAdmin]);

  const customerNameFor = (organizationId: string | null) => customerList.find((organization) => organization.id === organizationId)?.name || organizationId || "Platform";
  const filteredUsers = useMemo(() => users.filter((user) => {
    const matchesQuery = !query.trim() || user.email.toLowerCase().includes(query.trim().toLowerCase());
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "disabled" ? user.disabled : !user.disabled);
    const matchesScope = !scope || user.organization_id === scope;
    return matchesQuery && matchesRole && matchesStatus && matchesScope;
  }), [users, query, roleFilter, statusFilter, scope]);

  const resetUserForm = () => setUserForm({ email: "", password: "", role: "OPERATOR" });
  const resetTokenForm = () => setTokenForm({ name: "", maxUses: 1 });

  const openEditUser = (user: User) => {
    if (user.role === "SUPER_ADMIN") return;
    setEditTarget(user);
    setEditForm({ email: user.email, password: "", role: user.role, organization_id: user.organization_id || "" });
  };

  const saveUser = async () => {
    if (!editTarget || !editForm.email.trim()) {
      toast.warning("Email address is required.");
      return;
    }
    if (editForm.password && (editForm.password.length < 12 || editForm.password.length > 72)) {
      toast.warning("Password must be between 12 and 72 characters.");
      return;
    }
    setSaving(true);
    try {
      const value: Record<string, unknown> = { email: editForm.email.trim(), role: editForm.role };
      if (editForm.password) value.password = editForm.password;
      if (isSuperAdmin) value.organization_id = editForm.organization_id || null;
      await api(`users/${editTarget.id}`, "PATCH", value);
      toast.success("User account updated");
      setEditTarget(null);
      await loadScopedData();
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const enableUser = async (user: User) => {
    try {
      await api(`users/${user.id}/enable`, "POST", {});
      toast.success("User enabled");
      await loadScopedData();
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  const createUser = async () => {
    if (!userForm.email.trim() || userForm.password.length < 12 || userForm.password.length > 72) {
      toast.warning("Enter an email and a password between 12 and 72 characters.");
      return;
    }
    if (isSuperAdmin && !scope) {
      toast.warning("Choose a customer scope before creating a user.");
      return;
    }
    setSaving(true);
    try {
      await api("users", "POST", { email: userForm.email.trim(), password: userForm.password, role: userForm.role, organization_id: scope });
      toast.success("User account created");
      setUserOpen(false);
      resetUserForm();
      await loadScopedData();
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const createToken = async () => {
    if (!tokenForm.name.trim()) {
      toast.warning("Give the enrollment token a purpose or name.");
      return;
    }
    if (isSuperAdmin && !scope) {
      toast.warning("Choose a customer scope before generating a token.");
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ token: string }>("enrollment-tokens", "POST", {
        name: tokenForm.name.trim(),
        max_uses: tokenForm.maxUses,
        organization_id: scope,
        expires_at: null,
        group_ids: [],
      });
      setCreatedToken(result.token);
      toast.success("Enrollment token generated");
      resetTokenForm();
      await loadScopedData();
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const disableUser = async () => {
    if (!disableTarget) return;
    try {
      await api(`users/${disableTarget.id}/disable`, "POST", {});
      toast.success("User disabled");
      setDisableTarget(null);
      await loadScopedData();
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  const revokeToken = async () => {
    if (!revokeTarget) return;
    try {
      await api(`enrollment-tokens/${revokeTarget.id}`, "DELETE");
      toast.success("Enrollment token revoked");
      setRevokeTarget(null);
      await loadScopedData();
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    }
  };

  const createCustomer = async () => {
    if (!customerName.trim()) {
      toast.warning("Customer name is required.");
      return;
    }
    setSaving(true);
    try {
      await api("organizations", "POST", { name: customerName.trim() });
      toast.success("Customer created");
      setCustomerName("");
      setCustomerOpen(false);
      await loadScopedData();
      onRefresh();
    } catch (err) {
      toast.error(formatApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="-m-6 min-h-full bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center border border-accent bg-accent text-accent-foreground"><Users className="size-4" /></span>
          <div>
            <h1 className="font-display text-[22px] font-semibold text-balance">Users &amp; access</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground text-pretty">Manage accounts, enrollment credentials, and customer boundaries from one administrative workspace.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => { onRefresh(); void loadScopedData(); }} disabled={loading}><span className={loading ? "size-3.5 animate-spin" : "size-3.5"}>↻</span>Refresh</Button>
      </header>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
        <TabsList className="h-auto w-full justify-start rounded-none border-b border-border bg-card px-6 py-0">
          <TabsTrigger value="accounts" className="rounded-none border-b-2 border-transparent px-3 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"><Users className="size-3.5" />Accounts</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="tokens" className="rounded-none border-b-2 border-transparent px-3 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"><KeyRound className="size-3.5" />Enrollment tokens</TabsTrigger>}
          {isSuperAdmin && <TabsTrigger value="customers" className="rounded-none border-b-2 border-transparent px-3 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"><Building2 className="size-3.5" />Customers</TabsTrigger>}
        </TabsList>

        <TabsContent value="accounts" className="mt-0">
          <Card className="rounded-none border-x-0 border-t-0 shadow-none">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle>Accounts</CardTitle><CardDescription>Role assignments are enforced by the RMS API on every request.</CardDescription></div>
                <Button size="sm" onClick={() => setUserOpen(true)}><UserPlus className="size-4" />Add user</Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-wrap gap-2 border-b border-border p-4">
                <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search users by email" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by email…" className="h-9 pl-8" /></div>
                {isSuperAdmin && <ScopeSelect value={scope} organizations={customerList} onChange={setScope} />}
                <select aria-label="Filter by role" className={selectClass} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All roles</option><option value="SUPER_ADMIN">Super admin</option><option value="ORG_ADMIN">Org admin</option><option value="OPERATOR">Operator</option><option value="VIEWER">Viewer</option></select>
                <select aria-label="Filter by status" className={selectClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All status</option><option value="active">Active</option><option value="disabled">Disabled</option></select>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id} className={user.disabled ? "border-l-2 border-l-neutral2 bg-neutral2-bg/35" : "border-l-2 border-l-ok-rail"}>
                        <TableCell><div className="font-medium">{user.email}</div><div className="font-mono text-[10px] text-muted-foreground">{user.id}</div></TableCell>
                        <TableCell><div className="font-medium capitalize">{formatRole(user.role).toLowerCase()}</div><div className="font-mono text-[10px] text-muted-foreground">{user.role}</div></TableCell>
                        <TableCell className="text-[12px]">{customerNameFor(user.organization_id)}</TableCell>
                        <TableCell><Badge variant={user.disabled ? "secondary" : "ok"}>{user.disabled ? "Disabled" : "Active"}</Badge></TableCell>
                        <TableCell className="text-right"><div className="flex justify-end gap-1.5">{user.role !== "SUPER_ADMIN" && <Button variant="outline" size="sm" onClick={() => openEditUser(user)}><Pencil className="size-3.5" />Edit</Button>}{user.disabled ? <Button variant="outline" size="sm" onClick={() => void enableUser(user)}><UserCheck className="size-3.5" />Enable</Button> : <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={user.id === currentUser.id || user.role === "SUPER_ADMIN"} onClick={() => setDisableTarget(user)}>Disable</Button>}</div></TableCell>
                      </TableRow>
                    ))}
                    {!filteredUsers.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-xs text-muted-foreground">{loading ? "Loading accounts…" : "No accounts match this scope and filter."}</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-x-0 border-t-0 shadow-none">
            <CardHeader><CardTitle>Capability summary</CardTitle><CardDescription>Role capabilities are intentionally summarized here; the server remains the source of truth.</CardDescription></CardHeader>
            <CardContent className="p-0">
              <Table><TableHeader><TableRow><TableHead>Capability</TableHead><TableHead>Viewer</TableHead><TableHead>Operator</TableHead><TableHead>Org admin</TableHead><TableHead>Super admin</TableHead></TableRow></TableHeader><TableBody>
                {[
                  ["View fleet and telemetry", "Allowed", "Allowed", "Allowed", "Allowed"],
                  ["Open remote sessions", "—", "Allowed", "Allowed", "Allowed"],
                  ["Manage users and enrollment", "—", "—", "Customer", "All customers"],
                  ["Manage customers and platform bundles", "—", "—", "—", "Allowed"],
                ].map(([capability, ...values]) => <TableRow key={capability}><TableCell className="font-medium">{capability}</TableCell>{values.map((value, index) => <TableCell key={`${capability}-${index}`} className={value === "—" ? "text-muted-foreground" : "text-ok"}>{value}</TableCell>)}</TableRow>)}
              </TableBody></Table>
            </CardContent>
          </Card>
        </TabsContent>

        {isSuperAdmin && <TabsContent value="tokens" className="mt-0">
          <Card className="rounded-none border-x-0 border-t-0 shadow-none">
            <CardHeader className="border-b border-border pb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Enrollment tokens</CardTitle><CardDescription>One-time credentials for router auto-enrollment. The token value is shown only after creation.</CardDescription></div><Button size="sm" onClick={() => { setCreatedToken(null); setTokenOpen(true); }}><KeyRound className="size-4" />Generate token</Button></div></CardHeader>
            <CardContent className="p-0"><div className="border-b border-border p-4">{isSuperAdmin && <ScopeSelect value={scope} organizations={customerList} onChange={setScope} />}</div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Name / purpose</TableHead><TableHead>Uses</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
              {tokens.filter((token) => !scope || token.organization_id === scope).map((token) => <TableRow key={token.id}><TableCell><div className="font-medium">{token.name}</div><div className="font-mono text-[10px] text-muted-foreground">{token.id}</div></TableCell><TableCell className="font-mono text-[11px] tabular-nums">{token.used_count} / {token.max_uses ?? "∞"}</TableCell><TableCell className="text-[12px]">{customerNameFor(token.organization_id)}</TableCell><TableCell><Badge variant={token.revoked ? "secondary" : "ok"}>{token.revoked ? "Revoked" : "Active"}</Badge></TableCell><TableCell className="text-right"><Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={token.revoked} onClick={() => setRevokeTarget(token)}>Revoke</Button></TableCell></TableRow>)}
              {!tokens.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-xs text-muted-foreground">{loading ? "Loading tokens…" : "No enrollment tokens in this scope."}</TableCell></TableRow>}
            </TableBody></Table></div></CardContent>
          </Card>
        </TabsContent>}

        {isSuperAdmin && <TabsContent value="customers" className="mt-0"><Card className="rounded-none border-x-0 border-t-0 shadow-none"><CardHeader className="border-b border-border pb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Customers</CardTitle><CardDescription>Tenant boundaries for users, devices, templates, and telemetry.</CardDescription></div><Button size="sm" onClick={() => setCustomerOpen(true)}><Building2 className="size-4" />Create customer</Button></div></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Organization ID</TableHead><TableHead className="text-right">Scope</TableHead></TableRow></TableHeader><TableBody>{customerList.map((organization) => <TableRow key={organization.id}><TableCell className="font-medium">{organization.name}</TableCell><TableCell className="font-mono text-[10.5px] text-muted-foreground">{organization.id}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => { setScope(organization.id); setActiveTab("accounts"); }}>Open scope</Button></TableCell></TableRow>)}{!customerList.length && <TableRow><TableCell colSpan={3} className="h-28 text-center text-xs text-muted-foreground">No customer organizations.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>}
      </Tabs>

      <Dialog open={userOpen} onOpenChange={setUserOpen}><DialogContent><DialogHeader><DialogTitle>Add user account</DialogTitle><DialogDescription>Passwords must be between 12 and 72 characters. Choose the least-privileged role that fits the job.</DialogDescription></DialogHeader><div className="space-y-4"><div>{isSuperAdmin && <ScopeSelect value={scope} organizations={customerList} onChange={setScope} />}</div><div><label htmlFor="new-user-email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email address</label><Input id="new-user-email" type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} placeholder="operator@customer.com" /></div><div><label htmlFor="new-user-password" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Initial password</label><Input id="new-user-password" type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} placeholder="12–72 characters" /></div><div><div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Role</div><div className="grid gap-2 sm:grid-cols-3">{roleOptions.map((option) => <button type="button" key={option.value} aria-pressed={userForm.role === option.value} onClick={() => setUserForm({ ...userForm, role: option.value })} className={`rounded-lg border p-3 text-left transition-colors ${userForm.role === option.value ? "border-primary bg-accent" : "border-border hover:bg-secondary/60"}`}><span className="block text-[12px] font-semibold">{option.label}</span><span className="mt-1 block text-[11px] text-muted-foreground">{option.description}</span></button>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setUserOpen(false)} disabled={saving}>Cancel</Button><Button onClick={createUser} disabled={saving}>{saving ? "Creating…" : "Create user"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}><DialogContent><DialogHeader><DialogTitle>Edit user account</DialogTitle><DialogDescription>Update credentials, role, or customer assignment. Leave password blank to keep it unchanged.</DialogDescription></DialogHeader><div className="space-y-4"><div><label htmlFor="edit-user-email" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email address</label><Input id="edit-user-email" type="email" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></div><div><label htmlFor="edit-user-password" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">New password</label><Input id="edit-user-password" type="password" value={editForm.password} onChange={(event) => setEditForm({ ...editForm, password: event.target.value })} placeholder="Leave blank to keep current password" /></div><div><label htmlFor="edit-user-role" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Role</label><select id="edit-user-role" className={`${selectClass} w-full`} value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value as typeof editForm.role })}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>{isSuperAdmin && <ScopeSelect value={editForm.organization_id} organizations={customerList} onChange={(value) => setEditForm({ ...editForm, organization_id: value })} />}</div><DialogFooter><Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>Cancel</Button><Button onClick={() => void saveUser()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={tokenOpen} onOpenChange={(open) => { setTokenOpen(open); if (!open) setCreatedToken(null); }}><DialogContent>{createdToken ? <><DialogHeader><DialogTitle>Copy enrollment token</DialogTitle><DialogDescription>This secret is returned once. Store it securely before closing.</DialogDescription></DialogHeader><div className="rounded-lg border border-warn-border bg-warn-bg p-4"><div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-warn"><KeyRound className="size-4" />Token value</div><code className="block break-all font-mono text-[11px] text-warn">{createdToken}</code></div><DialogFooter><Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(createdToken); toast.success("Token copied"); }}><Copy className="size-4" />Copy</Button><Button onClick={() => { setTokenOpen(false); setCreatedToken(null); }}>Done</Button></DialogFooter></> : <><DialogHeader><DialogTitle>Generate enrollment token</DialogTitle><DialogDescription>Use a clear purpose so operators know which router batch the credential belongs to.</DialogDescription></DialogHeader><div className="space-y-4">{isSuperAdmin && <ScopeSelect value={scope} organizations={customerList} onChange={setScope} />}<div><label htmlFor="token-name" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Token name</label><Input id="token-name" value={tokenForm.name} onChange={(event) => setTokenForm({ ...tokenForm, name: event.target.value })} placeholder="Warehouse batch" /></div><div><label htmlFor="token-uses" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Maximum uses</label><Input id="token-uses" type="number" min={1} max={10000} value={tokenForm.maxUses} onChange={(event) => setTokenForm({ ...tokenForm, maxUses: Number(event.target.value) })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setTokenOpen(false)} disabled={saving}>Cancel</Button><Button onClick={createToken} disabled={saving}>{saving ? "Generating…" : "Generate token"}</Button></DialogFooter></>}</DialogContent></Dialog>

      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}><DialogContent><DialogHeader><DialogTitle>Create customer</DialogTitle><DialogDescription>New users, devices, and telemetry will be isolated to this organization.</DialogDescription></DialogHeader><Input aria-label="Customer name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Acme network" /><DialogFooter><Button variant="outline" onClick={() => setCustomerOpen(false)} disabled={saving}>Cancel</Button><Button onClick={createCustomer} disabled={saving}>{saving ? "Creating…" : "Create customer"}</Button></DialogFooter></DialogContent></Dialog>
      <ConfirmDialog open={!!disableTarget} onOpenChange={(open) => !open && setDisableTarget(null)} title="Disable user account?" description="This user will be logged out and cannot access RMS until an administrator enables the account again." confirmLabel="Disable account" onConfirm={disableUser} />
      <ConfirmDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)} title="Revoke enrollment token?" description="Routers that have not used this credential will no longer be able to enroll with it." confirmLabel="Revoke token" onConfirm={revokeToken} />
    </div>
  );
}
