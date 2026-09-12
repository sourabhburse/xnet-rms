import React from "react";
import { Plus } from "lucide-react";

import { User } from "../../types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const DEVICE_TAB_VIEWS = [
  "devices",
  "groups",
  "registration-requests",
  "available-to-claim",
  "add-devices",
] as const;

interface DevicesAreaProps {
  user: User;
  currentView: string;
  onSelectView: (view: string) => void;
  counts: {
    devices: number;
    offline?: number;
    groups: number;
    awaiting: number;
    unclaimed: number;
  };
  children: React.ReactNode;
}

export function DevicesArea({
  user,
  currentView,
  onSelectView,
  counts,
  children,
}: DevicesAreaProps) {
  const isOrgAdmin =
    user.role === "SUPER_ADMIN" || user.role === "ORG_ADMIN";

  const tabs: { value: string; label: string; count?: number }[] = [
    { value: "devices", label: "All devices", count: counts.devices },
    { value: "groups", label: "Groups", count: counts.groups },
  ];
  if (isOrgAdmin) {
    tabs.push(
      {
        value: "registration-requests",
        label: "Awaiting",
        count: counts.awaiting,
      },
      {
        value: "available-to-claim",
        label: "Unclaimed",
        count: counts.unclaimed,
      }
    );
  }

  const activeTab = currentView === "add-devices" ? "devices" : currentView;

  return (
    <div className="flex min-h-full flex-col bg-background">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-card px-6 pb-[18px] pt-6">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">
            Devices
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {counts.devices.toLocaleString()} enrolled · {(counts.offline ?? 0).toLocaleString()} offline
          </p>
        </div>
        {isOrgAdmin && (
          <Button onClick={() => onSelectView("add-devices")}>
            <Plus className="size-4" />
            Add devices
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={onSelectView}>
        <TabsList className="w-full gap-5 bg-card px-6">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.count != null && (
                <span className="font-mono text-[10.5px] tabular-nums opacity-70">
                  {t.count.toLocaleString()}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="px-6 pb-6 pt-4">{children}</div>
    </div>
  );
}
