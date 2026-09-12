import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Code2,
  Columns3,
  Download,
  Globe2,
  MoreHorizontal,
  Router,
  Search,
  X,
} from "lucide-react";

import { Device, TagItem, User } from "../types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

interface DeviceListProps {
  user: User;
  devices: Device[];
  total: number;
  page: number;
  loading: boolean;
  tags: TagItem[];
  searchQuery: string;
  selectedTag: string;
  statusFilter: string;
  onSearchChange: (q: string) => void;
  onTagChange: (tag: string) => void;
  onStatusChange: (status: string) => void;
  onPageChange: (page: number) => void;
  onSelectDevice: (device: Device) => void;
  onOpenLuCI: (device: Device) => void;
  onOpenTerminal: (device: Device) => void;
}

type SignalReading = { value: number; unit: string } | null;
type DeviceWithNetwork = Device & { ip?: string; ip_address?: string; wan_ip?: string };
type ColumnKey = "model" | "group" | "signal" | "last_seen";

const PAGE_SIZE = 100;
const statusOptions = [
  { value: "", label: "All" },
  { value: "ONLINE", label: "Online" },
  { value: "OFFLINE", label: "Offline" },
  { value: "REVOKED", label: "Revoked" },
];

function relativeTime(value: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return seconds <= 0 ? "Just now" : "In under a minute";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ${seconds < 0 ? "ago" : "from now"}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ${seconds < 0 ? "ago" : "from now"}`;
  return `${Math.abs(Math.round(hours / 24))}d ${seconds < 0 ? "ago" : "from now"}`;
}

function extractSignal(device: Device): SignalReading {
  for (const source of device.sources ?? []) {
    for (const [key, field] of Object.entries(source.fields ?? {})) {
      const haystack = `${key} ${field.label ?? ""} ${field.unit ?? ""}`.toLowerCase();
      if (!haystack.includes("rsrp") && field.unit?.toLowerCase() !== "dbm") continue;
      const value = typeof field.value === "number" ? field.value : Number.parseFloat(String(field.value));
      if (Number.isFinite(value)) return { value, unit: field.unit || "dBm" };
    }
  }
  return null;
}

function signalLevel(signal: SignalReading) {
  if (!signal) return 0;
  return signal.value >= -80 ? 4 : signal.value >= -90 ? 3 : signal.value >= -100 ? 2 : 1;
}

function networkAddress(device: Device) {
  const candidate = device as DeviceWithNetwork;
  return candidate.ip || candidate.ip_address || candidate.wan_ip || "No IP reported";
}

function statusRail(status: Device["status"]) {
  return status === "ONLINE" ? "border-l-ok" : status === "OFFLINE" ? "border-l-down" : "border-l-neutral2";
}

function signalTone(signal: SignalReading) {
  if (!signal) return "text-muted-foreground";
  return signal.value < -100 ? "text-down" : signal.value < -90 ? "text-warn" : "text-foreground/75";
}

function SignalBars({ signal }: { signal: SignalReading }) {
  const level = signalLevel(signal);
  const heights = ["h-1", "h-2", "h-3", "h-4"];
  const fill = level <= 1 ? "bg-down" : level === 2 ? "bg-warn" : "bg-ok";
  return (
    <span className="flex h-4 items-end gap-0.5" aria-label={signal ? `${Math.round(signal.value)} ${signal.unit}` : "No signal data"}>
      {heights.map((height, index) => <span key={height} className={cn("w-1 rounded-sm", height, index < level ? fill : "bg-secondary")} />)}
    </span>
  );
}

function FilterButton({ label, value }: { label: string; value?: string }) {
  return <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className={cn("gap-1.5 font-normal", value && "border-primary bg-accent text-accent-foreground")}><span className="max-w-[140px] truncate">{value || label}</span><ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" /></Button></DropdownMenuTrigger>;
}

function exportCsv(devices: Device[]) {
  const header = ["Device", "Serial", "Model", "Group", "Status", "Last seen"];
  const rows = devices.map((device) => [device.name || "", device.serial_number, device.model || "", device.groups?.join("; ") || "", device.status, device.last_seen || ""]);
  const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "xnet-devices.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function DeviceList({
  user,
  devices,
  total,
  page,
  loading,
  tags,
  searchQuery,
  selectedTag,
  statusFilter,
  onSearchChange,
  onTagChange,
  onStatusChange,
  onPageChange,
  onSelectDevice,
  onOpenLuCI,
  onOpenTerminal,
}: DeviceListProps) {
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [modelFilter, setModelFilter] = useState(() => new URLSearchParams(window.location.search).get("model") || "");
  const [groupFilter, setGroupFilter] = useState(() => new URLSearchParams(window.location.search).get("group") || "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columnVisibility, setColumnVisibility] = useState<Record<ColumnKey, boolean>>(() => {
    const hidden = new Set((new URLSearchParams(window.location.search).get("columns") || "").split(",").filter(Boolean));
    return { model: !hidden.has("model"), group: !hidden.has("group"), signal: !hidden.has("signal"), last_seen: !hidden.has("last_seen") };
  });
  const canOperate = user.role !== "VIEWER";

  useEffect(() => setSearchInput(searchQuery), [searchQuery]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const values: Record<string, string> = { q: searchQuery, status: statusFilter, tag: selectedTag, model: modelFilter, group: groupFilter };
    Object.entries(values).forEach(([key, value]) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
    const hidden = Object.entries(columnVisibility).filter(([, visible]) => !visible).map(([key]) => key).join(",");
    if (hidden) url.searchParams.set("columns", hidden); else url.searchParams.delete("columns");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [columnVisibility, groupFilter, modelFilter, searchQuery, selectedTag, statusFilter]);

  const applySearch = () => { if (searchInput !== searchQuery) onSearchChange(searchInput); };
  const modelOptions = useMemo(() => Array.from(new Set(devices.map((device) => device.model || "Unknown model"))).sort(), [devices]);
  const groupOptions = useMemo(() => Array.from(new Set(devices.flatMap((device) => device.groups ?? []))).sort(), [devices]);
  const filteredDevices = useMemo(() => devices.filter((device) => {
    const signal = extractSignal(device);
    const signalMatches = statusFilter !== "WEAK_SIGNAL" || (signal != null && signal.value < -90);
    return signalMatches && (!modelFilter || (device.model || "Unknown model") === modelFilter) && (!groupFilter || device.groups?.includes(groupFilter));
  }), [devices, groupFilter, modelFilter, statusFilter]);
  const allVisibleSelected = filteredDevices.length > 0 && filteredDevices.every((device) => selected.has(device.id));
  const displayedCount = modelFilter || groupFilter || statusFilter === "WEAK_SIGNAL" ? filteredDevices.length : total;
  const pageCount = Math.max(1, Math.ceil(displayedCount / PAGE_SIZE));
  const first = displayedCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, displayedCount);

  const toggleAll = () => setSelected((current) => {
    const next = new Set(current);
    if (allVisibleSelected) filteredDevices.forEach((device) => next.delete(device.id)); else filteredDevices.forEach((device) => next.add(device.id));
    return next;
  });
  const clearFilters = () => { setSearchInput(""); onSearchChange(""); setModelFilter(""); setGroupFilter(""); onTagChange(""); onStatusChange(""); onPageChange(1); };

  return (
    <section className="overflow-hidden border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
        <div><h2 className="font-display text-[15px] font-semibold text-foreground">All devices</h2><p className="mt-0.5 text-[13px] text-muted-foreground">{total.toLocaleString()} enrolled routers</p></div>
        <Button variant="outline" size="sm" onClick={() => exportCsv(filteredDevices)}><Download />Export CSV</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/20 px-6 py-3">
        <div className="relative w-[260px] max-w-full"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search devices" placeholder="Search name, serial, MAC…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applySearch(); } }} onBlur={applySearch} className="h-8 bg-card pl-8 text-[13px]" /></div>
        <div className="flex items-center rounded-md border border-input bg-card p-0.5">{statusOptions.map((option) => <button key={option.value || "all"} type="button" onClick={() => { onStatusChange(option.value); onPageChange(1); }} aria-pressed={statusFilter === option.value} className={cn("rounded px-2.5 py-1 text-[12px] transition-colors", statusFilter === option.value ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>{option.label}</button>)}</div>
        {statusFilter === "WEAK_SIGNAL" && <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary bg-accent px-2.5 text-[12px] font-medium text-accent-foreground" onClick={() => { onStatusChange(""); onPageChange(1); }}>Weak signal <X className="size-3.5" /></button>}
        <DropdownMenu><FilterButton label="Model" value={modelFilter} /><DropdownMenuContent align="start" className="min-w-[190px]"><DropdownMenuLabel>Model</DropdownMenuLabel><DropdownMenuRadioGroup value={modelFilter} onValueChange={(value) => { setModelFilter(value); onPageChange(1); }}><DropdownMenuRadioItem value="">All models</DropdownMenuRadioItem>{modelOptions.map((model) => <DropdownMenuRadioItem key={model} value={model}>{model}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
        <DropdownMenu><FilterButton label="Group" value={groupFilter} /><DropdownMenuContent align="start" className="min-w-[190px]"><DropdownMenuLabel>Group</DropdownMenuLabel><DropdownMenuRadioGroup value={groupFilter} onValueChange={(value) => { setGroupFilter(value); onPageChange(1); }}><DropdownMenuRadioItem value="">All groups</DropdownMenuRadioItem>{groupOptions.map((group) => <DropdownMenuRadioItem key={group} value={group}>{group}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className={cn("gap-1.5 font-normal", selectedTag && "border-primary bg-accent text-accent-foreground")}>Tag{selectedTag && <span className="max-w-[100px] truncate">: {selectedTag}</span>}<ChevronsUpDown className="size-3.5 text-muted-foreground" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-[190px]"><DropdownMenuLabel>Tag</DropdownMenuLabel><DropdownMenuRadioGroup value={selectedTag} onValueChange={(value) => { onTagChange(value); onPageChange(1); }}><DropdownMenuRadioItem value="">All tags</DropdownMenuRadioItem>{tags.map((tag) => <DropdownMenuRadioItem key={tag.id} value={tag.name}>{tag.name}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-1.5 font-normal"><Columns3 className="size-3.5" /><span className="hidden sm:inline">Columns</span></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-[180px]"><DropdownMenuLabel>Columns</DropdownMenuLabel><DropdownMenuSeparator />{(["model", "group", "signal", "last_seen"] as ColumnKey[]).map((column) => <DropdownMenuCheckboxItem key={column} checked={columnVisibility[column]} onCheckedChange={(checked) => setColumnVisibility((current) => ({ ...current, [column]: Boolean(checked) }))}>{column === "last_seen" ? "Last seen" : column[0].toUpperCase() + column.slice(1)}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
        {(searchQuery || selectedTag || statusFilter || modelFilter || groupFilter) && <button type="button" className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline" onClick={clearFilters}>Clear filters <X className="size-3.5" /></button>}
      </div>

      {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/60 px-6 py-2.5 text-[12px] text-accent-foreground"><span className="font-medium">{selected.size} selected</span><Button variant="outline" size="sm" className="h-7 border-primary/25 bg-card">Move to group</Button><Button variant="outline" size="sm" className="h-7 border-primary/25 bg-card">Add tag</Button><Button variant="outline" size="sm" className="h-7 border-primary/25 bg-card">Assign template</Button><button type="button" className="ml-auto font-medium text-primary hover:underline" onClick={() => setSelected(new Set())}>Clear selection</button></div>}

      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[28px_minmax(250px,2.2fr)_minmax(125px,1.2fr)_minmax(125px,1.1fr)_minmax(92px,.9fr)_minmax(92px,.9fr)_auto] items-center gap-4 border-b border-border px-6 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"><button type="button" className="grid size-4 place-items-center rounded border border-input bg-card" aria-label={allVisibleSelected ? "Clear visible selection" : "Select visible devices"} onClick={toggleAll}>{allVisibleSelected && <Check className="size-3 text-primary" />}</button><span>Device</span>{columnVisibility.model ? <span>Model</span> : <span />}{columnVisibility.group ? <span>Group</span> : <span />}{columnVisibility.signal ? <span>Signal</span> : <span />}{columnVisibility.last_seen ? <span>Last seen</span> : <span />}<span /> </div>
          {loading ? <div className="px-6 py-12 text-center text-[13px] text-muted-foreground">Loading devices…</div> : filteredDevices.length ? filteredDevices.map((device) => {
            const signal = extractSignal(device);
            const selectedRow = selected.has(device.id);
            const revoked = device.status === "REVOKED" || device.revoked;
            return <div key={device.id} className={cn("grid grid-cols-[28px_minmax(250px,2.2fr)_minmax(125px,1.2fr)_minmax(125px,1.1fr)_minmax(92px,.9fr)_minmax(92px,.9fr)_auto] items-center gap-4 border-b border-row-divider border-l-[3px] px-6 py-3", statusRail(device.status), device.status === "OFFLINE" && "bg-row-down-bg", revoked && "text-muted-foreground opacity-70")}>
              <button type="button" className={cn("grid size-4 place-items-center rounded border bg-card", selectedRow ? "border-primary" : "border-input")} aria-label={selectedRow ? `Deselect ${device.name || device.serial_number}` : `Select ${device.name || device.serial_number}`} onClick={() => setSelected((current) => { const next = new Set(current); if (next.has(device.id)) next.delete(device.id); else next.add(device.id); return next; })}>{selectedRow && <Check className="size-3 text-primary" />}</button>
              <button type="button" className="min-w-0 text-left" onClick={() => onSelectDevice(device)}><span className="flex items-center gap-2"><span className="block truncate text-[13px] font-semibold text-foreground">{device.name || "Unnamed device"}</span><span className={cn("size-1.5 shrink-0 rounded-full", device.status === "ONLINE" ? "bg-ok" : device.status === "OFFLINE" ? "bg-down" : "bg-neutral2")} /></span><span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{device.serial_number} · {networkAddress(device)}</span></button>
              {columnVisibility.model ? <span className="truncate text-[13px] text-foreground/75">{device.model || "Unknown model"}<span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{device.firmware_version ? `v${device.firmware_version}` : ""}</span></span> : <span />}
              {columnVisibility.group ? <span className="truncate text-[13px] text-foreground/75">{device.groups?.[0] || "No group"}{(device.groups?.length ?? 0) > 1 && <span className="ml-1 font-mono text-[11px] text-muted-foreground">+{device.groups!.length - 1}</span>}</span> : <span />}
              {columnVisibility.signal ? <span className={cn("flex items-center gap-2", signalTone(signal))}><SignalBars signal={signal} /><span className="font-mono text-[12px]">{signal ? Math.round(signal.value) : "—"}</span></span> : <span />}
              {columnVisibility.last_seen ? <span className={cn("whitespace-nowrap font-mono text-[12px]", device.status === "OFFLINE" ? "text-down" : "text-foreground/75")} title={device.last_seen ? new Date(device.last_seen).toLocaleString() : undefined}>{relativeTime(device.last_seen)}</span> : <span />}
              <div className="flex items-center justify-end gap-1.5"><Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px]" disabled={!canOperate || device.status !== "ONLINE"} onClick={() => onOpenLuCI(device)}><Globe2 className="size-3.5" />LuCI</Button><Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px]" disabled={!canOperate || device.status !== "ONLINE"} onClick={() => onOpenTerminal(device)}><Code2 className="size-3.5" />SSH</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="size-7" aria-label={`More actions for ${device.name || device.serial_number}`}><MoreHorizontal className="size-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>{device.name || device.serial_number}</DropdownMenuLabel><DropdownMenuItem onSelect={() => onSelectDevice(device)}>Open details</DropdownMenuItem><DropdownMenuItem onSelect={() => navigator.clipboard?.writeText(device.lan_mac || "")}>Copy LAN MAC</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
            </div>;
          }) : <div className="px-6 py-14 text-center"><Router className="mx-auto mb-2 size-5 text-muted-foreground/50" /><p className="text-[13px] font-medium text-foreground">No devices found</p><p className="mt-1 text-[13px] text-muted-foreground">Try a different search or filter.</p></div>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-[13px] text-muted-foreground"><span>Showing {first.toLocaleString()}–{last.toLocaleString()} of {displayedCount.toLocaleString()}</span><div className="flex items-center gap-2"><span className="font-mono text-[12px]">Page {page} of {pageCount}</span><Button variant="outline" size="icon" className="size-7" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon" className="size-7" aria-label="Next page" disabled={page >= pageCount || loading} onClick={() => onPageChange(page + 1)}><ChevronRight className="size-3.5" /></Button></div></div>
    </section>
  );
}
