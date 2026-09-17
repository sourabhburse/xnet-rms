export interface AppRoute {
  view: string;
  deviceSerial: string | null;
  templateId: string | null;
}

const ADMIN_VIEWS = new Set([
  "users",
  "enrollment-tokens",
  "profiles",
  "tags",
  "audit-logs",
  "organizations",
  "products",
  "bundles",
]);

const DEVICE_TABS: Record<string, string> = {
  groups: "groups",
  awaiting: "onboarding",
  unclaimed: "onboarding",
  add: "onboarding",
};

export function parseAppRoute(pathname: string, search: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/" || path === "/overview") {
    return { view: "dashboard", deviceSerial: null, templateId: null };
  }

  if (path === "/templates/new") {
    return { view: "template-new", deviceSerial: null, templateId: null };
  }

  if (path.startsWith("/templates/") && path.endsWith("/edit")) {
    const templateId = path.slice("/templates/".length, -"/edit".length).replace(/\/$/, "");
    return { view: "template-edit", deviceSerial: null, templateId: templateId || null };
  }

  if (path === "/devices") {
    const tab = new URLSearchParams(search).get("tab") || "";
    return { view: DEVICE_TABS[tab] || "devices", deviceSerial: null, templateId: null };
  }

  if (path === "/onboarding") {
    return { view: "onboarding", deviceSerial: null, templateId: null };
  }

  if (path.startsWith("/devices/")) {
    const encodedSerial = path.slice("/devices/".length);
    try {
      return {
        view: "devices",
        deviceSerial: decodeURIComponent(encodedSerial),
        templateId: null,
      };
    } catch {
      return { view: "devices", deviceSerial: encodedSerial, templateId: null };
    }
  }

  if (path === "/sessions") {
    return { view: "sessions", deviceSerial: null, templateId: null };
  }

  if (path === "/reports") {
    return { view: "reports", deviceSerial: null, templateId: null };
  }

  if (path === "/alerts") {
    return { view: "alerts", deviceSerial: null, templateId: null };
  }

  if (path.startsWith("/admin/")) {
    const section = path.slice("/admin/".length);
    if (section === "enrollment-tokens") {
      return { view: "onboarding", deviceSerial: null, templateId: null };
    }
    return {
      view: ADMIN_VIEWS.has(section) ? section : "dashboard",
      deviceSerial: null,
      templateId: null,
    };
  }

  return { view: "dashboard", deviceSerial: null, templateId: null };
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
      return "/onboarding";
    case "available-to-claim":
      return "/onboarding";
    case "add-devices":
      return "/onboarding";
    case "onboarding":
      return "/onboarding";
    case "sessions":
      return "/sessions";
    case "reports":
      return "/reports";
    case "alerts":
      return "/alerts";
    case "users":
    case "profiles":
    case "tags":
    case "audit-logs":
    case "organizations":
    case "products":
    case "bundles":
      return `/admin/${view}`;
    case "enrollment-tokens":
      return "/onboarding";
    default:
      return "/overview";
  }
}

export function routeForTemplateNew(): string {
  return "/templates/new";
}

export function routeForTemplateEdit(id: string): string {
  return `/templates/${encodeURIComponent(id)}/edit`;
}

export function routeForDevice(serial: string): string {
  return `/devices/${encodeURIComponent(serial)}`;
}
