import React from "react";

import { Organization, User } from "../../types";
import { AppSidebar, SidebarCounts } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { Theme } from "@/lib/use-theme";

interface AppShellProps {
  user: User;
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
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  React.useEffect(() => {
    if (!mobileNavOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

  const selectMobileView = (view: string) => {
    onSelectView(view);
    setMobileNavOpen(false);
  };

  return (
    <div className="grid h-screen grid-cols-1 overflow-hidden bg-background lg:grid-cols-[248px_1fr]">
      <div className="hidden min-h-0 lg:block">
        <AppSidebar
          user={user}
          currentView={currentView}
          onSelectView={onSelectView}
          counts={counts}
        />
      </div>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-10 h-full w-[min(86vw,300px)] shadow-2xl">
            <AppSidebar
              user={user}
              currentView={currentView}
              onSelectView={selectMobileView}
              counts={counts}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-col">
        <Topbar
          user={user}
          onOpenMenu={() => setMobileNavOpen(true)}
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
        <main className="min-h-0 flex-1 overflow-y-auto bg-background">{children}</main>
      </div>
    </div>
  );
}
