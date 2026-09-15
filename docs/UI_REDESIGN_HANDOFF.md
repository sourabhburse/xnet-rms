# XNET RMS — UI redesign handoff

Instructions for continuing the frontend restyle. Give this file to the agent that
picks up the work.

---

## 1. Goal

**Remove Ant Design entirely** and rebuild the whole `frontend/` app on
**shadcn/ui + Tailwind v4 + TanStack Table**, in a clean light‑SaaS look, keeping
the existing API layer and behaviour. Accent colour is the **XNET brand blue**
sampled from the logo (`frontend/public/logo/xnet-logo-transparent.png`): navy
`#203864` → `#2E5496` → `#3F6BB0` → azure `#668BCE`.

**Definition of done:** `grep -rn "antd\|@ant-design" frontend/src` returns
nothing; `antd` and `@ant-design/icons` are gone from `frontend/package.json`;
the `ConfigProvider` wrapper is gone from `frontend/src/main.tsx`; every screen
listed in §2 ("still on Ant") has been rebuilt with shadcn/Tailwind; `npm run
build` passes. This is a replacement of the component library, not a re‑skin of
Ant.

Visual reference (static mockup of the target):
<https://claude.ai/code/artifact/056e0c40-48ab-49f5-b483-d1117b99cfc2>
It shows the app shell, Fleet overview, Devices list, Device detail, and the token
set. Match its structure and spacing; it is the source of truth for layout.

Two product decisions baked into the redesign:

- **Lean sidebar.** No more six near‑duplicate "Device…" nav items. One `Devices`
  entry; groups + onboarding queues are **tabs on the Devices page** (Teltonika‑RMS
  style). `Monitoring templates` lives under Administration.
- **Revoke leaves the Device‑detail header.** Destructive actions go into a `⋯`
  overflow menu, each behind a confirm.

Refresh-keeps-your-place is handled by an interim hash/localStorage shim
(`lib/nav-persistence.ts`); a proper `react-router-dom` pass is still open — see §7.

---

## 2. What is already done (increment 1)

Build foundation + app shell + Fleet overview. `npm run build` and `tsc --noEmit`
are green. Everything not migrated still renders on Ant and works.

**Added deps** (`frontend/package.json`): `tailwindcss@4`, `@tailwindcss/vite@4`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`,
`lucide-react`, `@tanstack/react-table`, `sonner`, and Radix primitives
(`@radix-ui/react-{slot,dropdown-menu,tabs,tooltip,dialog,select,avatar,separator,scroll-area,popover}`).

**Build config**
- `frontend/vite.config.ts` — added `@tailwindcss/vite` plugin and `@` → `./src` alias.
- `frontend/tsconfig.json` — added `baseUrl` + `paths` (`@/*`).
- `frontend/index.html` — Google Fonts: Sora, Inter, JetBrains Mono.

**Design tokens** — `frontend/src/styles/globals.css` (imported once in `main.tsx`).
Full light + `.dark` palette as CSS variables, exposed to Tailwind via
`@theme inline`. This is the single source of truth for colour/radius/fonts.
Semantic status tokens: `ok` / `down` / `warn` / `neutral2` (each has
`-bg` and `-border` companions). Chart ramp: `chart-1..5`.

**shadcn components** — `frontend/src/components/ui/`: `button`, `card`, `badge`,
`input`, `tabs`, `table`, `dropdown-menu`, `tooltip`, `avatar`, `separator`,
`scroll-area`, `sonner`. Hand‑authored (Tailwind v4 / `data-slot` style). Add more
with the same conventions as you need them — do **not** run `npx shadcn init`
(interactive; would rewrite config).

**App shell** — `frontend/src/components/shell/`
- `AppShell.tsx` — grid layout: sidebar (`lg+`) + `Topbar` + scrollable `<main>`.
- `AppSidebar.tsx` — lean role‑aware nav. `Devices` stays highlighted for all
  device‑family views.
- `Topbar.tsx` — breadcrumb, search (`⌘K` affordance), super‑admin org switcher
  (Dropdown), theme toggle, refresh, user menu (sign out).
- `BrandMark.tsx` — the four‑circle XNET mark as inline SVG.
- `frontend/src/lib/use-theme.ts` — `light`/`dark`, persisted to `localStorage`
  (`xnet-theme`), toggles `.dark` on `<html>`.

**Fleet overview** — `frontend/src/components/overview/FleetOverview.tsx` (new;
replaces `frontend/src/components/FleetOverview.tsx`). KPI tiles, connectivity +
health, hardware breakdown bars, LTE signal‑quality distribution (parses RSRP from
`device.sources` — graceful empty state when absent), active sessions, onboarding
queue, device groups. No fabricated data — everything comes from existing props.

**Devices page wrapper** — `frontend/src/components/devices/DevicesArea.tsx`.
Renders the page header + shadcn `Tabs` strip (`All devices` / `Groups` /
`Awaiting` / `Unclaimed`) and slots the still‑Ant child component for the active
tab. `DEVICE_TAB_VIEWS` lists the view keys it owns.

**Wiring** — `frontend/src/App.tsx` now renders `<AppShell>` + `<Toaster>`; the
dashboard view uses the new `FleetOverview`; device‑family views render inside
`<DevicesArea>`; all other views render their existing Ant component inside a
`p-6` wrapper. All state, effects, and handlers (`refreshData`, `handleOpenLuCI`,
`handleOpenTerminal`, `handleSignOut`, filters, paging) are unchanged.

**Preview harness** (dev aid, safe to keep or delete):
`frontend/preview-shell.html` + `frontend/src/preview-shell.tsx` render the shell +
overview with mock data at `/preview-shell.html` so you can see new components
without a backend. `.claude/launch.json` has a `rms-frontend` dev‑server config
(port 5199).

**Still on Ant, not yet migrated** (all under `frontend/src/components/`):
`DeviceList`, `DeviceDetail`, `AddDevices`, `AvailableToClaim`,
`RegistrationRequests`, `GroupsManager`, `TagsManager`, `SessionsManager`,
`AdminViews`, `Login`, `Onboarding`. Dead once migration completes:
`Navbar.tsx`, `Sidebar.tsx`, `StatsBar.tsx`, old `FleetOverview.tsx`, most of
`rms.css`.

---

## 2a. What replaces Ant Design

Umbrella: **shadcn/ui** (Radix primitives + Tailwind, component source copied into
`src/components/ui/`) for interactive UI, **TanStack Table** for every data grid,
**sonner** for toasts, **lucide-react** for icons. `recharts` and `xterm` stay,
restyled via tokens.

| Ant Design | Replacement | Status |
|---|---|---|
| `ConfigProvider` / theme tokens | CSS vars in `globals.css` + Tailwind v4 | done |
| `Layout` / `Sider` / `Header` | `shell/AppShell` · `AppSidebar` · `Topbar` | done |
| `Table` | `@tanstack/react-table` + `ui/table.tsx` | table shell done; grids per §4 |
| `Button` | `ui/button.tsx` | done |
| `Card` | `ui/card.tsx` | done |
| `Tag` (status) | `ui/badge.tsx` (`ok`/`down`/`warn`/`neutral`/`accent` variants) | done |
| `Tabs` | `ui/tabs.tsx` | done |
| `Input` / `Input.Search` | `ui/input.tsx` | done |
| `Select` | shadcn `select` (Radix Select) | add |
| `Modal` | shadcn `dialog` (Radix Dialog) | add |
| `Modal.confirm` / `Modal.error` | shadcn `alert-dialog` (Radix) | add — §4.1 |
| `message.*` / `notification` | `sonner` — `toast.*` | done (wired in `App.tsx`) |
| `Dropdown` / `Menu` | `ui/dropdown-menu.tsx` | done |
| `Tooltip` | `ui/tooltip.tsx` | done |
| `Descriptions` | plain `<dl>` 2-col grid, mono values | pattern |
| `Form` + rules | `react-hook-form` + `zod` + shadcn `form` (or plain controlled state) | add |
| `DatePicker` | shadcn `calendar` + `popover` (`react-day-picker`) | add if used |
| `Space` / `Divider` | flex/grid `gap` + `ui/separator.tsx` | done |
| `Progress` | plain `<div>` meter (see `FleetOverview`) | pattern |
| `Alert` | shadcn `alert` | add |
| `Avatar` | `ui/avatar.tsx` | done |
| `@ant-design/icons` | `lucide-react` | done |
| `recharts` | keep, restyle with tokens | — |
| `xterm` | keep, restyle chrome | — |

"add" = create the component in `src/components/ui/` with the same conventions as
the existing ones (Tailwind v4, `data-slot`, `cn()`, `cva` for variants); install
its Radix package if not already present.

---

## 3. Conventions

- **Colour only through tokens.** Use Tailwind utilities that resolve to the
  tokens (`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`,
  `text-primary`, `bg-ok-bg text-ok border-ok-border`, `bg-chart-2`, …). Never a
  raw hex in a component. If you need a new semantic colour, add it to
  `globals.css` (`:root`, `.dark`, and `@theme inline`) first.
- **Fonts:** `font-display` (Sora) for headings/large numbers, default
  `font-sans` (Inter) for UI, `font-mono` (JetBrains Mono) for serials, MACs,
  dBm, timestamps, IDs. Use `tabular-nums` on any column of digits.
- **Type + case:** sentence case everywhere. Card titles ~13.5px/600, page
  titles ~21px/600, table headers 10.5px uppercase tracked.
- **Not everything is a card.** One elevation. Dense rows use `divide-y`, not
  nested rounded cards.
- **Radius:** `rounded-md` for controls, `rounded-xl` for cards.
- **Icons:** `lucide-react`, `size-4` inline / `size-[17px]` in nav.
- **`cn()`** from `@/lib/utils` for class merging. Variants via `cva` (see
  `button.tsx` / `badge.tsx`).
- **Toasts:** `import { toast } from "sonner"` — replace Ant `message.*` and
  `Modal.error/confirm` (use a shadcn `alert-dialog` for confirms — add that
  component).
- **Imports:** `@/components/...`, `@/lib/...`. Types stay at `../../types`.
- Keep every component's props and callbacks **identical** to the Ant version so
  `App.tsx` wiring does not change. Migrate the inside, not the interface.

---

## 4. Remaining work — do in this order

The job is to **delete Ant Design**. Each step below rebuilds one screen with
shadcn/Tailwind so that, by the end, no file imports `antd`. Per step: build the
shadcn version, keep the exact prop interface, swap it in `App.tsx` (usually
already wired), remove that screen's `antd` / `@ant-design/icons` imports, verify
`tsc --noEmit` + `npm run build`, eyeball via the preview harness or a real
login. §4.8 removes the dependency itself.

### 4.1 `alert-dialog` + toast swap (prerequisite)
Add `src/components/ui/alert-dialog.tsx` (Radix `@radix-ui/react-alert-dialog` —
install it). Create a small `useConfirm()` helper or a `<ConfirmDialog>` so the
other screens can drop `Modal.confirm`. Swap `message.*` → `toast.*` app‑wide.

### 4.2 `DeviceList.tsx` → TanStack Table
Columns from the mockup: Device (icon + name + serial mono), Model / firmware,
Network identity (MAC mono + IP/last seen), Group & tags (chips), Signal (mini
bars + dBm mono), Status (`Badge` ok/down/neutral), Last seen (relative, mono),
row‑hover actions (`LuCI` / `SSH` / `Details` — `Button size="sm" variant="outline"`,
shown on `group-hover`). Toolbar: search `Input`, status segmented control
(reuse the `Tabs` look or a small button group), Model / Group / Tag filter
`DropdownMenu`s, `Columns` toggle. Footer: "Showing X–Y of N" + Prev/Next.
Keep props: `devices,total,page,loading,tags,searchQuery,selectedTag,statusFilter,
onSearchChange,onTagChange,onStatusChange,onPageChange,onSelectDevice,onOpenLuCI,
onOpenTerminal`. Pagination stays server‑driven (pageSize 100) — TanStack in
manual mode.

### 4.3 `DeviceDetail.tsx`
Header: back button, device name (`font-display` 20/600), status `Badge`,
context chips (serial / model / group / firmware). Actions: `Refresh telemetry`
+ a `⋯` `DropdownMenu` containing `Rename device`, `Move to group…`,
`Edit tags…`, separator, `Revoke access…` (`variant="destructive"`, opens the
confirm dialog). **Remove the standalone Revoke button.** Remote‑access card:
tinted (`bg-accent` / `border-accent`), `Open LuCI` (primary) + `Open terminal`
(outline), note about the reverse tunnel + 180 s rollback watchdog. Tabs
(shadcn `Tabs`): Overview / Telemetry / History / Sessions. Overview = identity
`<dl>` (2‑col, mono values) + live‑telemetry metric grid (RSRP / SINR / CPU /
memory / throughput / temp with mini meters). History = keep Recharts, restyle:
axis/grid/text via `var(--muted-foreground)` / `var(--border)`, line
`var(--chart-2)`, 2px, area fill `var(--accent)`, emphasised endpoint. Keep
props `device,user,onBack,onRefreshDevice` and all the session/snapshot/history
fetch logic.

### 4.4 Onboarding trio inside `DevicesArea`
`AddDevices`, `AvailableToClaim`, `RegistrationRequests` — same prop interfaces.
Forms: shadcn `input` + add `label`, `select`, `checkbox`, `form` (or plain
controlled state + `zod` if you want). Tables: same TanStack pattern as 4.2.
These already render inside `<DevicesArea>`; just replace the internals.

### 4.5 `GroupsManager.tsx`, `TagsManager.tsx`, `SessionsManager.tsx`
CRUD lists — bordered rows + `alert-dialog` for deletes. Keep props.

### 4.6 `AdminViews.tsx`
Biggest one — it switches on `view` for users / enrollment‑tokens / organizations
/ profiles / bundles / audit‑logs. Split into one component per view under
`src/components/admin/` if that's cleaner, but keep a single `<AdminViews
view=... />` facade so `App.tsx` is untouched. Tables + forms as above.

### 4.7 `Login.tsx` + `Onboarding.tsx` + `terminal.ts`
Login: centre card, XNET brand mark, the split‑screen showcase is optional.
`terminal.html` / `terminal.ts` (xterm) — just theme the surrounding chrome;
xterm colours can read the tokens.

### 4.8 Cleanup
Delete `Navbar.tsx`, `Sidebar.tsx`, `StatsBar.tsx`, old
`components/FleetOverview.tsx`, `preview-shell.*`. Strip `rms.css` down to
anything still referenced (ideally delete it and its `import './rms.css'`).
Remove `antd` + `@ant-design/icons` from `package.json`, delete the
`ConfigProvider` wrapper in `main.tsx`. Run `npm run build`; grep for `from 'antd'`
and `antd/` to confirm zero references.

---

## 5. Gotchas

- **Ant + Tailwind coexistence.** `globals.css` uses the full `@import
  "tailwindcss";` (includes preflight). During migration, preflight can slightly
  restyle not‑yet‑migrated Ant screens (button borders, heading margins). It is
  cosmetic and temporary — do not spend time fighting it; migrate the screen
  instead. Once Ant is gone this is moot.
- **`.dark` class** is toggled on `<html>` by `use-theme.ts`. All dark values are
  defined under `.dark { … }` in `globals.css`. Never define a colour only inside
  a media/`.dark` block without a `:root` default.
- **`neutral` is a Tailwind built‑in ramp** — the project's neutral status token
  is `neutral2` (`bg-neutral2-bg text-neutral2 border-neutral2-border`) to avoid
  clobbering `bg-neutral-500` etc.
- **Fractional spacing** (`gap-4.5`, `p-4.5`) is valid in Tailwind v4.
- Keep `recharts` and `xterm` — only restyle them.
- `noUnusedLocals` is off in tsconfig; still, remove dead imports as you go.

---

## 6. Verify each step

```bash
cd frontend
npx tsc --noEmit
npm run build
```

Visual check without a backend: `npm run dev` (or the `rms-frontend` launch
config) then open `http://localhost:5199/preview-shell.html`. Extend
`src/preview-shell.tsx` with mock props to preview whatever screen you're on.
For a real check, run the backend and log in.

---

## 7. Routing

**Completed.** The temporary hash/localStorage shim has been retired. The app
uses `react-router-dom` with these routes:

- `/overview` — overview dashboard (the root path redirects here).
- `/devices` with `?tab=groups|awaiting|unclaimed|add` for the device family
  tabs and onboarding form.
- `/devices/:serial` — device detail, loaded by serial on direct navigation.
- `/sessions` — remote sessions.
- `/admin/:section` — users, enrollment tokens, monitoring templates, tags,
  audit records, customers, and collector bundles.

`AppShell` remains the shared layout. Navigation actions use router navigation,
and the Go server falls back to the embedded `index.html` for application routes
so refreshes and pasted links work in production as well as in Vite.
