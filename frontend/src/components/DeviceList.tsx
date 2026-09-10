import React, { useEffect, useMemo, useState } from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import type { ColumnVisibilityState } from "@tanstack/table-core";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Code2,
  Columns3,
  Globe2,
  Router,
  Search,
} from "lucide-react";

import { Device, TagItem, User } from "../types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
type DeviceWithNetwork = Device & {
  ip?: string;
  ip_address?: string;
  wan_ip?: string;
};

const PAGE_SIZE = 100;

function relativeTime(value: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  if (absolute < 60) return seconds <= 0 ? "Just now" : "In under a minute";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return `${Math.abs(minutes)}m ${seconds < 0 ? "ago" : "from now"}`;
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return `${Math.abs(hours)}h ${seconds < 0 ? "ago" : "from now"}`;
  }
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ${seconds < 0 ? "ago" : "from now"}`;
}

function extractSignal(device: Device): SignalReading {
  for (const source of device.sources ?? []) {
    for (const [key, field] of Object.entries(source.fields ?? {})) {
      const haystack = `${key} ${field.label ?? ""} ${field.unit ?? ""}`.toLowerCase();
      if (!haystack.includes("rsrp") && (field.unit ?? "").toLowerCase() !== "dbm") {
        continue;
      }
      const value = typeof field.value === "number" ? field.value : Number.parseFloat(String(field.value));
      if (Number.isFinite(value)) return { value, unit: field.unit || "dBm" };
    }
  }
  return null;
}

function signalLevel(signal: SignalReading) {
  if (!signal) return 0;
  return Math.max(1, Math.min(4, Math.round((signal.value + 120) / 12.5)));
}

function getNetworkAddress(device: Device) {
  const candidate = device as DeviceWithNetwork;
  return candidate.ip || candidate.ip_address || candidate.wan_ip || "No IP reported";
}

function statusVariant(status: Device["status"]): "ok" | "down" | "neutral" {
  if (status === "ONLINE") return "ok";
  if (status === "OFFLINE") return "down";
  return "neutral";
}

function statusLabel(status: Device["status"]) {
  return status === "ONLINE" ? "Online" : status === "OFFLINE" ? "Offline" : "Revoked";
}

function FilterButton({ label, value }: { label: string; value?: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" className="gap-1.5 font-normal">
        <span className="max-w-[110px] truncate">{value || label}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
  );
}

function DeviceSkeleton() {
  return (
    <TableRow>
      {Array.from({ length: 8 }).map((_, index) => (
        <TableCell key={index}>
          <span
            className={cn(
              "block h-4 animate-pulse rounded bg-secondary",
              index === 0 ? "w-40" : "w-24"
            )}
          />
        </TableCell>
      ))}
    </TableRow>
  );
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
  const [modelFilter, setModelFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({
    identity: true,
    labels: true,
    signal: true,
    last_seen: true,
  });
  const canOperate = user.role !== "VIEWER";

  useEffect(() => setSearchInput(searchQuery), [searchQuery]);

  const applySearch = () => {
    if (searchInput !== searchQuery) onSearchChange(searchInput);
  };

  const modelOptions = useMemo(
    () => Array.from(new Set(devices.map((device) => device.model || "Niseva router"))).sort(),
    [devices]
  );
  const groupOptions = useMemo(
    () => Array.from(new Set(devices.flatMap((device) => device.groups ?? []))).sort(),
    [devices]
  );
  const filteredDevices = useMemo(
    () => devices.filter((device) => {
      const modelMatches = !modelFilter || (device.model || "Niseva router") === modelFilter;
      const groupMatches = !groupFilter || (device.groups ?? []).includes(groupFilter);
      return modelMatches && groupMatches;
    }),
    [devices, groupFilter, modelFilter]
  );

  const columns = useMemo<LegacyColumnDef<Device>[]>(
    () => [
      {
        id: "device",
        header: "Device",
        cell: ({ row }) => {
          const device = row.original;
          return (
            <button
              type="button"
              className="group/device flex min-w-[190px] items-center gap-2.5 text-left"
              onClick={() => onSelectDevice(device)}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-accent bg-accent text-accent-foreground">
                <Router className="size-4" />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[13px] font-semibold text-foreground group-hover/device:text-primary">
                  {device.name || "Unnamed device"}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">
                  {device.serial_number || "No serial"}
                </span>
              </span>
            </button>
          );
        },
      },
      {
        id: "model",
        header: "Model / firmware",
        cell: ({ row }) => (
          <div className="min-w-[130px] leading-tight">
            <div className="text-[12.5px] font-medium text-foreground/90">
              {row.original.model || "Niseva router"}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {row.original.firmware_version
                ? `Firmware v${row.original.firmware_version}`
                : "Firmware unknown"}
            </div>
          </div>
        ),
      },
      {
        id: "identity",
        header: "Network identity",
        cell: ({ row }) => {
          const device = row.original;
          return (
            <div className="min-w-[150px] leading-tight">
              <div className="font-mono text-[11px] text-foreground/85">
                {device.lan_mac || "—"}
              </div>
              <div
                className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground"
                title={getNetworkAddress(device)}
              >
                {getNetworkAddress(device)}
              </div>
            </div>
          );
        },
      },
      {
        id: "labels",
        header: "Group & tags",
        cell: ({ row }) => {
          const device = row.original;
          const groups = device.groups ?? [];
          const labels = [...groups, ...(device.tags ?? [])];
          return labels.length ? (
            <div className="flex max-w-[185px] flex-wrap gap-1">
              {labels.slice(0, 4).map((label, index) => (
                <Badge
                  key={`${label}-${index}`}
                  variant={index < groups.length ? "accent" : "secondary"}
                  className="max-w-[100px] truncate font-normal"
                >
                  {label}
                </Badge>
              ))}
              {labels.length > 4 && (
                <span className="px-1 text-[11px] text-muted-foreground">
                  +{labels.length - 4}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground">No labels</span>
          );
        },
      },
      {
        id: "signal",
        header: "Signal",
        cell: ({ row }) => {
          const signal = extractSignal(row.original);
          const level = signalLevel(signal);
          return (
            <div className="flex min-w-[76px] items-center gap-2">
              <span
                className="flex h-4 items-end gap-0.5"
                aria-label={signal ? `${signal.value} ${signal.unit}` : "No signal data"}
              >
                {[1, 2, 3, 4].map((bar) => (
                  <span
                    key={bar}
                    className={cn(
                      "w-1 rounded-sm",
                      bar === 1 ? "h-1" : bar === 2 ? "h-2" : bar === 3 ? "h-3" : "h-4",
                      bar <= level ? "bg-primary" : "bg-secondary"
                    )}
                  />
                ))}
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {signal ? `${Math.round(signal.value)} dBm` : "—"}
              </span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={statusVariant(row.original.status)}>
            <span className="size-1.5 rounded-full bg-current" />
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "last_seen",
        header: "Last seen",
        cell: ({ row }) => (
          <span
            className="whitespace-nowrap font-mono text-[10.5px] text-muted-foreground"
            title={row.original.last_seen ? new Date(row.original.last_seen).toLocaleString() : undefined}
          >
            {relativeTime(row.original.last_seen)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableHiding: false,
        cell: ({ row }) => {
          const device = row.original;
          return (
            <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {canOperate && device.status === "ONLINE" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    title="Open LuCI"
                    onClick={() => onOpenLuCI(device)}
                  >
                    <Globe2 className="size-3.5" />
                    LuCI
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    title="Open terminal"
                    onClick={() => onOpenTerminal(device)}
                  >
                    <Code2 className="size-3.5" />
                    SSH
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onSelectDevice(device)}
              >
                Details
              </Button>
            </div>
          );
        },
      },
    ],
    [canOperate, onOpenLuCI, onOpenTerminal, onSelectDevice]
  );

  const table = useLegacyTable({
    data: filteredDevices,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingCount = modelFilter || groupFilter ? filteredDevices.length : total;
  const first = showingCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, showingCount);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 border-b border-border px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display text-sm font-semibold">Device inventory</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {total.toLocaleString()} enrolled routers in this workspace
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-[220px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search devices"
                placeholder="Search name, serial, MAC or model"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applySearch();
                  }
                }}
                onBlur={applySearch}
                className="h-8 pl-8 text-[12px]"
              />
            </div>
            <div className="flex items-center rounded-md border border-input bg-card p-0.5">
              {[
                { value: "", label: "All" },
                { value: "ONLINE", label: "Online" },
                { value: "OFFLINE", label: "Offline" },
                { value: "REVOKED", label: "Revoked" },
              ].map((option) => (
                <button
                  key={option.value || "all"}
                  type="button"
                  onClick={() => onStatusChange(option.value)}
                  aria-pressed={statusFilter === option.value}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                    statusFilter === option.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <DropdownMenu>
              <FilterButton label="Model" value={modelFilter} />
              <DropdownMenuContent align="end" className="min-w-[190px]">
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={modelFilter}
                  onValueChange={(value) => {
                    setModelFilter(value);
                    onPageChange(1);
                  }}
                >
                  <DropdownMenuRadioItem value="">All models</DropdownMenuRadioItem>
                  {modelOptions.map((model) => (
                    <DropdownMenuRadioItem key={model} value={model}>{model}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <FilterButton label="Group" value={groupFilter} />
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuLabel>Group</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={groupFilter}
                  onValueChange={(value) => {
                    setGroupFilter(value);
                    onPageChange(1);
                  }}
                >
                  <DropdownMenuRadioItem value="">All groups</DropdownMenuRadioItem>
                  {groupOptions.map((group) => (
                    <DropdownMenuRadioItem key={group} value={group}>{group}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 font-normal">
                  <span className="hidden sm:inline">Tag</span>
                  <span className="sm:hidden">Tags</span>
                  {selectedTag && <span className="max-w-[80px] truncate">{selectedTag}</span>}
                  <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuLabel>Tag</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={selectedTag} onValueChange={onTagChange}>
                  <DropdownMenuRadioItem value="">All tags</DropdownMenuRadioItem>
                  {tags.map((tag) => (
                    <DropdownMenuRadioItem key={tag.id} value={tag.name}>{tag.name}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="size-8 px-0" aria-label="Choose columns">
                  <Columns3 className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table.getAllLeafColumns().filter((column) => column.getCanHide()).map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
                  >
                    {column.columnDef.header?.toString() || column.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={cn(header.column.id === "actions" && "w-[1%] pr-4")}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(devices.length || 5, 5) }).map((_, index) => <DeviceSkeleton key={index} />)
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="group">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn(cell.column.id === "actions" && "pr-4")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-36 text-center">
                  <div className="flex flex-col items-center justify-center gap-1">
                    <Router className="mb-1 size-5 text-muted-foreground/50" />
                    <p className="text-[13px] font-medium text-foreground">No devices found</p>
                    <p className="text-xs text-muted-foreground">Try a different search or filter.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter className="gap-3 px-4 py-2.5">
        <span>
          Showing {first.toLocaleString()}–{last.toLocaleString()} of {showingCount.toLocaleString()}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-2 font-mono text-[10.5px] tabular-nums">Page {page} of {pageCount}</span>
          <Button variant="outline" size="icon" className="size-7" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="size-7" aria-label="Next page" disabled={page >= pageCount || loading} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
