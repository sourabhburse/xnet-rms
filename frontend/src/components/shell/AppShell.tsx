import React from "react";

import { Organization, User } from "../../types";
import { AppSidebar, SidebarCounts } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { Theme } from "@/lib/use-theme";

interface AppShellProps {
  user: User;
  orgName: string;
  organizations: Organization[];
  selectedOrg: string;
  onSelectOrg: (orgId: string) => void;
  currentView: string;
  onSelectView: (view: string) => void;
  counts: SidebarCounts;
  crumb: React.ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onSignOut: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  children: React.ReactNode;
}

export function AppShell({
  user,
  orgName,
  organizations,
  selectedOrg,
  onSelectOrg,
  currentView,
  onSelectView,
  counts,
  crumb,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  onRefresh,
  refreshing,
  onSignOut,
  theme,
  onToggleTheme,
  children,
}: AppShellProps) {
  return (
    <div className="grid h-screen grid-cols-1 overflow-hidden bg-background lg:grid-cols-[248px_1fr]">
      <div className="hidden min-h-0 lg:block">
        <AppSidebar
          user={user}
          orgName={orgName}
          currentView={currentView}
          onSelectView={onSelectView}
          counts={counts}
        />
      </div>

      <div className="flex min-w-0 flex-col">
        <Topbar
          user={user}
          crumb={crumb}
          organizations={organizations}
          selectedOrg={selectedOrg}
          onSelectOrg={onSelectOrg}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          onSearchSubmit={onSearchSubmit}
          onRefresh={onRefresh}
          refreshing={refreshing}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onSignOut={onSignOut}
        />
        <main className="flex-1 overflow-y-auto bg-background">{children}</main>
      </div>
    </div>
  );
}
