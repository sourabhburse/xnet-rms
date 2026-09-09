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
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[21px] font-semibold text-foreground">
            Devices
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            One place for devices, groups, and onboarding.
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
        <TabsList>
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

      <div>{children}</div>
    </div>
  );
}
