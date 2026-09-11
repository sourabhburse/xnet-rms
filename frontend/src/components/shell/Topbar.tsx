import React from "react";
import {
  Search,
  RefreshCw,
  Moon,
  Sun,
  LogOut,
  Building2,
  Check,
  ChevronDown,
  Menu,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Organization, User } from "../../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface TopbarProps {
  user: User;
  onOpenMenu: () => void;
  crumb: React.ReactNode;
  organizations: Organization[];
  selectedOrg: string;
  onSelectOrg: (orgId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSignOut: () => void;
}

export function Topbar({
  user,
  onOpenMenu,
  crumb,
  organizations,
  selectedOrg,
  onSelectOrg,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  onRefresh,
  refreshing,
  theme,
  onToggleTheme,
  onSignOut,
}: TopbarProps) {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const initials = (user.email || "?").slice(0, 2).toUpperCase();
  const [searchDraft, setSearchDraft] = React.useState(searchValue);
  const activeOrgName =
    organizations.find((o) => o.id === selectedOrg)?.name ?? "All customers";

  React.useEffect(() => setSearchDraft(searchValue), [searchValue]);

  const submitSearch = () => {
    onSearchChange(searchDraft);
    onSearchSubmit(searchDraft);
  };

  return (
    <header className="flex h-[58px] shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3.5 sm:px-4">
      <Button
        variant="outline"
        size="icon"
        className="size-9 shrink-0 lg:hidden"
        aria-label="Open navigation"
        onClick={onOpenMenu}
      >
        <Menu className="size-4" />
      </Button>

      <div className="min-w-0 max-w-[34vw] truncate text-[13px] text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
        {crumb}
      </div>

      <div className="relative ml-auto hidden w-[300px] max-w-[40vw] sm:block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search devices"
          value={searchDraft}
          placeholder="Search devices, serials, MAC…"
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitSearch();
            }
          }}
          className="h-9 bg-secondary/60 pl-8 pr-12 text-[13px]"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-card px-1.5 py-px font-mono text-[10.5px] text-muted-foreground">
          ⌘K
        </kbd>
      </div>

      {isSuperAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="size-9 shrink-0 px-0 text-[13px] font-normal sm:h-9 sm:w-auto sm:gap-2 sm:px-3"
              aria-label={`Select customer scope, currently ${activeOrgName}`}
            >
              <Building2 className="size-3.5 text-muted-foreground" />
              <span className="hidden max-w-[160px] truncate sm:inline">{activeOrgName}</span>
              <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuLabel>Customer scope</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onSelectOrg("")}>
              <span className="flex-1">All customers (platform)</span>
              {selectedOrg === "" && <Check className="size-4" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onSelect={() => onSelectOrg(org.id)}
              >
                <span className="flex-1 truncate">{org.name}</span>
                {selectedOrg === org.id && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        variant="outline"
        size="icon"
        className="size-9"
        aria-label="Toggle theme"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )}
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="size-9"
        aria-label="Refresh telemetry"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-full border border-border bg-card py-1 pl-1 pr-2.5 transition-colors hover:border-border/70"
          >
            <Avatar className="size-7">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden leading-tight sm:block">
              <span className="block max-w-[150px] truncate text-[12px] font-semibold text-foreground">
                {user.email}
              </span>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                {user.role.replace("_", " ")}
              </span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuLabel className="normal-case tracking-normal">
            <div className="text-[12px] font-semibold text-foreground">
              {user.email}
            </div>
            <div className="text-[11px] font-normal text-muted-foreground">
              {user.role.replace("_", " ")}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
