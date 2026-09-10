export interface AppRoute {
  view: string;
  deviceSerial: string | null;
}

const ADMIN_VIEWS = new Set([
  "users",
  "enrollment-tokens",
  "profiles",
  "tags",
  "audit-logs",
  "organizations",
  "bundles",
]);

const DEVICE_TABS: Record<string, string> = {
  groups: "groups",
  awaiting: "registration-requests",
  unclaimed: "available-to-claim",
  add: "add-devices",
};

export function parseAppRoute(pathname: string, search: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/overview") {
    return { view: "dashboard", deviceSerial: null };
  }

  if (path === "/devices") {
    const tab = new URLSearchParams(search).get("tab") || "";
    return { view: DEVICE_TABS[tab] || "devices", deviceSerial: null };
  }

  if (path.startsWith("/devices/")) {
    const encodedSerial = path.slice("/devices/".length);
    try {
      return {
        view: "devices",
        deviceSerial: decodeURIComponent(encodedSerial),
      };
    } catch {
      return { view: "devices", deviceSerial: encodedSerial };
    }
  }

  if (path === "/sessions") {
    return { view: "sessions", deviceSerial: null };
  }

  if (path === "/reports") {
    return { view: "reports", deviceSerial: null };
  }

  if (path.startsWith("/admin/")) {
    const section = path.slice("/admin/".length);
    return {
      view: ADMIN_VIEWS.has(section) ? section : "dashboard",
      deviceSerial: null,
    };
  }

  return { view: "dashboard", deviceSerial: null };
}

export function routeForView(view: string): string {
  switch (view) {
    case "dashboard":
      return "/overview";
    case "devices":
      return "/devices";
    case "groups":
      return "/devices?tab=groups";
    case "registration-requests":
      return "/devices?tab=awaiting";
    case "available-to-claim":
      return "/devices?tab=unclaimed";
    case "add-devices":
      return "/devices?tab=add";
    case "sessions":
      return "/sessions";
    case "reports":
      return "/reports";
    case "users":
    case "enrollment-tokens":
    case "profiles":
    case "tags":
    case "audit-logs":
    case "organizations":
    case "bundles":
      return `/admin/${view}`;
    default:
      return "/overview";
  }
}

export function routeForDevice(serial: string): string {
  return `/devices/${encodeURIComponent(serial)}`;
}
