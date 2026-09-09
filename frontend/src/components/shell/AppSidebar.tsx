import React from "react";
import {
  LayoutGrid,
  Server,
  Cable,
  Users,
  KeyRound,
  LineChart,
  Tags,
  ScrollText,
  Building2,
  TerminalSquare,
  ChevronsUpDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { User } from "../../types";
import { BrandMark } from "./BrandMark";

export interface SidebarCounts {
  devices: number;
  sessions: number;
}

interface NavEntry {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}

interface NavSection {
  heading?: string;
  items: NavEntry[];
}

interface AppSidebarProps {
  user: User;
  orgName: string;
  currentView: string;
  onSelectView: (view: string) => void;
  counts: SidebarCounts;
}

export function AppSidebar({
  user,
  orgName,
  currentView,
  onSelectView,
  counts,
}: AppSidebarProps) {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const isOrgAdmin = isSuperAdmin || user.role === "ORG_ADMIN";
  const isOperator = isOrgAdmin || user.role === "OPERATOR";

  const sections: NavSection[] = [
    {
      items: [
        { key: "dashboard", label: "Overview", icon: LayoutGrid },
        {
          key: "devices",
          label: "Devices",
          icon: Server,
          count: counts.devices || undefined,
        },
      ],
    },
  ];

  if (isOperator) {
    sections.push({
      heading: "Remote access",
      items: [
        {
          key: "sessions",
          label: "Sessions",
          icon: Cable,
          count: counts.sessions || undefined,
        },
      ],
    });
  }

  if (isOrgAdmin) {
    const admin: NavEntry[] = [
      { key: "users", label: "Users", icon: Users },
      { key: "enrollment-tokens", label: "Enrollment tokens", icon: KeyRound },
      { key: "profiles", label: "Monitoring templates", icon: LineChart },
      { key: "tags", label: "Customer tags", icon: Tags },
      { key: "audit-logs", label: "Audit records", icon: ScrollText },
    ];
    if (isSuperAdmin) {
      admin.push(
        { key: "organizations", label: "Customers", icon: Building2 },
        { key: "bundles", label: "Collector bundles", icon: TerminalSquare }
      );
    }
    sections.push({ heading: "Administration", items: admin });
  }

  const deviceGroupViews = new Set([
    "devices",
    "groups",
    "add-devices",
    "available-to-claim",
    "registration-requests",
  ]);

  return (
    <aside className="flex h-full w-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-4">
        <BrandMark className="h-6 w-9 shrink-0" />
        <div className="leading-tight">
          <div className="font-display text-sm font-bold tracking-tight text-foreground">
            XNET RMS
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Cloud router management
          </div>
        </div>
      </div>

      <button
        type="button"
        className="mx-3 mb-2.5 flex items-center gap-2.5 rounded-lg border border-border bg-secondary/60 px-2.5 py-2 text-left transition-colors hover:border-border/80 hover:bg-secondary"
      >
        <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-accent text-[10px] font-bold text-accent-foreground">
          {orgName.slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-semibold text-foreground">
            {orgName}
          </span>
          <span className="block text-[10.5px] text-muted-foreground">
            {counts.devices.toLocaleString()} devices
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
        {sections.map((section, si) => (
          <div key={section.heading ?? `s${si}`}>
            {section.heading && (
              <div className="px-2.5 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {section.heading}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const active =
                item.key === currentView ||
                (item.key === "devices" && deviceGroupViews.has(currentView));
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelectView(item.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[17px] shrink-0",
                      active ? "text-sidebar-primary" : "text-muted-foreground"
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.count != null && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums",
                        active
                          ? "bg-sidebar-primary/15 text-sidebar-primary"
                          : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {item.count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-sidebar-border px-4 py-3 text-[11px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-ok shadow-[0_0_0_3px_var(--ok-bg)]" />
        RMS core operational
        <span className="ml-auto font-mono">v3.0</span>
      </div>
    </aside>
  );
}
