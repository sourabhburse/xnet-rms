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
  FileBarChart,
  BellRing,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { User } from "../../types";
import { BrandMark } from "./BrandMark";

export interface SidebarCounts {
  devices: number;
  sessions: number;
  alerts?: number;
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
  currentView: string;
  onSelectView: (view: string) => void;
  counts: SidebarCounts;
}

export function AppSidebar({
  user,
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

  sections.push({
    heading: "Monitoring",
    items: [
      { key: "alerts", label: "Alerts", icon: BellRing, count: counts.alerts || undefined },
      { key: "reports", label: "Telemetry reports", icon: FileBarChart },
    ],
  });

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
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center px-[18px] pb-4 pt-[18px]">
        <BrandMark variant="dark" className="h-6 w-auto" />
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
        {sections.map((section, si) => (
          <div key={section.heading ?? `s${si}`}>
            {section.heading && (
              <div className="px-2.5 pb-1.5 pt-[18px] font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-sidebar-muted">
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
                    "mb-px flex w-full items-center gap-2.5 rounded-md px-2.5 py-[9px] text-left text-[13px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[17px] shrink-0",
                      active ? "text-sidebar-primary" : "text-sidebar-muted"
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.count != null && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums",
                        active
                          ? "bg-white/10 text-sidebar-accent-foreground"
                          : "text-sidebar-muted"
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

      <div className="flex items-center gap-2 border-t border-sidebar-border px-[18px] py-3.5 font-mono text-[11px] text-sidebar-muted">
        <span className="size-1.5 rounded-full bg-ok" />
        core operational
        <span className="ml-auto font-mono">v3.0</span>
      </div>
    </aside>
  );
}
