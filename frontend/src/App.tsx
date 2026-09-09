import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AuditRecord,
  CollectorBundle,
  DashboardStats,
  Device,
  EnrollmentToken,
  Organization,
  PendingDevice,
  Profile,
  Registration,
  SessionItem,
  TagItem,
  DeviceGroup,
  User,
} from './types';
import { api, formatApiError, ApiError } from './api';

// Components
import { AppShell } from './components/shell/AppShell';
import { DevicesArea, DEVICE_TAB_VIEWS } from './components/devices/DevicesArea';
import { Toaster } from './components/ui/sonner';
import { useTheme } from './lib/use-theme';
import FleetOverview from './components/overview/FleetOverview';
import DeviceList from './components/DeviceList';
import DeviceDetail from './components/DeviceDetail';
import AddDevices from './components/AddDevices';
import AvailableToClaim from './components/AvailableToClaim';
import RegistrationRequests from './components/RegistrationRequests';
import TagsManager from './components/TagsManager';
import GroupsManager from './components/GroupsManager';
import SessionsManager from './components/SessionsManager';
import AdminViews from './components/AdminViews';
import Login from './Login';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Active navigation view
  const [view, setView] = useState<string>('dashboard');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // Organization scoping
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);

  // Router and device data
  const [devices, setDevices] = useState<Device[]>([]);
  const [totalDevices, setTotalDevices] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Auxiliary data
  const [stats, setStats] = useState<DashboardStats>({ total: 0, online: 0, offline: 0, revoked: 0 });
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [adminData, setAdminData] = useState<any[]>([]);

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string>('');
  const { theme, toggle: toggleTheme } = useTheme();

  // Initial Auth Verification
  useEffect(() => {
    api<User>('auth/me')
      .then(u => {
        if (u && typeof u === 'object' && u.id && u.role) {
          setUser(u);
          if (u.role !== 'SUPER_ADMIN') {
            setSelectedOrg(u.organization_id);
          }
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoadingUser(false));
  }, []);

  // Fetch Organizations (for SUPER_ADMIN)
  useEffect(() => {
    if (user && user.role === 'SUPER_ADMIN') {
      api<Organization[]>('organizations')
        .then(orgs => setOrganizations(orgs || []))
        .catch(() => {});
    }
  }, [user]);

  // Main Data Refresh Function
  const refreshData = async () => {
    if (!user) return;
    setRefreshing(true);
    setGlobalError('');

    try {
      const isOrgAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ORG_ADMIN';
      const isOperator = isOrgAdmin || user.role === 'OPERATOR';

      // Always fetch dashboard stats and tags
      const [dashStats, tagList, groupList] = await Promise.all([
        api<DashboardStats>(`dashboard${selectedOrg ? `?organization_id=${encodeURIComponent(selectedOrg)}` : ''}`).catch(() => ({ total: 0, online: 0, offline: 0, revoked: 0 })),
        api<TagItem[]>('tags').catch(() => []),
        api<DeviceGroup[]>(`groups${selectedOrg ? `?organization_id=${encodeURIComponent(selectedOrg)}` : ''}`).catch(() => []),
      ]);
      setStats(dashStats && typeof dashStats === 'object' ? dashStats : { total: 0, online: 0, offline: 0, revoked: 0 });
      setTags(Array.isArray(tagList) ? tagList : []);
      setGroups(Array.isArray(groupList) ? groupList : []);

      // Fetch pending devices and registrations if admin
      if (isOrgAdmin) {
        const onboardingSuffix = selectedOrg ? `?organization_id=${encodeURIComponent(selectedOrg)}` : '';
        const [pending, regList] = await Promise.all([
          api<PendingDevice[]>(`pending-devices${onboardingSuffix}`).catch(() => []),
          api<Registration[]>(`registrations${onboardingSuffix}`).catch(() => []),
        ]);
        setPendingDevices(Array.isArray(pending) ? pending : []);
        setRegistrations(Array.isArray(regList) ? regList : []);
      }

      // Fetch active sessions if operator
      if (isOperator) {
        const sessionSuffix = selectedOrg ? `?organization_id=${encodeURIComponent(selectedOrg)}` : '';
        const sessList = await api<SessionItem[]>(`sessions${sessionSuffix}`).catch(() => []);
        setSessions(Array.isArray(sessList) ? sessList : []);
      }

      // Fetch view-specific dataset
      if (view === 'devices' || view === 'dashboard' || view === 'groups') {
        const params = new URLSearchParams({
          page: String(page),
          q: searchQuery,
          tag: selectedTag,
        });
        if (selectedOrg) params.set('organization_id', selectedOrg);
        const res = await api<{ items: Device[]; total: number }>(`devices?${params}`);
        let items = Array.isArray(res?.items) ? res.items : [];
        if (statusFilter) {
          items = items.filter(d => d.status === statusFilter);
        }
        setDevices(items);
        setTotalDevices(statusFilter ? items.length : (res?.total || 0));
      } else if (['users', 'enrollment-tokens', 'audit-logs', 'organizations', 'profiles', 'bundles'].includes(view)) {
        const suffix = selectedOrg && ['users', 'enrollment-tokens', 'audit-logs'].includes(view)
          ? `?organization_id=${encodeURIComponent(selectedOrg)}`
          : '';
        const res = await api<any[]>(`${view}${suffix}`);
        setAdminData(Array.isArray(res) ? res : []);
      }
    } catch (err) {
      const formatted = formatApiError(err);
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        setGlobalError(formatted.message);
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  // Trigger refresh on view, filter, or page change
  useEffect(() => {
    if (user) {
      refreshData();
    }
  }, [user, view, page, searchQuery, selectedTag, statusFilter, selectedOrg]);

  // Periodic background refresh every 30 seconds
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(refreshData, 30000);
    return () => clearInterval(interval);
  }, [user, view, page, searchQuery, selectedTag, statusFilter, selectedOrg]);

  // Remote LuCI Launcher (Server-Side SSH_LUCI)
  const handleOpenLuCI = async (dev: Device) => {
    try {
      toast.loading(`Initiating LuCI session for ${dev.serial_number}...`, { id: 'luci' });
      const session = await api<{ id: string; expires_at: string; launch_url: string }>(
        'sessions',
        'POST',
        { device_id: dev.id, protocol: 'SSH_LUCI' }
      );
      toast.success('LuCI tunnel ready; router login required.', { id: 'luci' });
      window.open(session.launch_url, '_blank');
      refreshData();
    } catch (err) {
      const formatted = formatApiError(err);
      toast.dismiss('luci');
      const notify = formatted.type === 'error' ? toast.error : toast.warning;
      notify(formatted.title, { description: formatted.message });
    }
  };

  // Remote Web Terminal Launcher (TERMINAL_SSH)
  const handleOpenTerminal = async (dev: Device) => {
    try {
      toast.loading(`Opening terminal for ${dev.serial_number}...`, { id: 'term' });
      const session = await api<{ id: string; expires_at: string; launch_url: string }>(
        'sessions',
        'POST',
        { device_id: dev.id, protocol: 'TERMINAL_SSH' }
      );
      toast.success('Terminal session authorized!', { id: 'term' });
      window.open(session.launch_url, '_blank');
      refreshData();
    } catch (err) {
      const formatted = formatApiError(err);
      toast.dismiss('term');
      toast.error(formatted.title, { description: formatted.message });
    }
  };

  const handleSignOut = async () => {
    try {
      await api('auth/logout', 'POST');
    } catch {}
    setUser(null);
    setSelectedDevice(null);
  };

  // Unauthenticated: Show NCMS-inspired Login Screen
  if (loadingUser) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <p className="text-sm text-muted-foreground">Loading XNET RMS...</p>
      </div>
    );
  }

  if (!user) {
    return <Login onLoginSuccess={setUser} api={api} />;
  }

  // Count pending devices awaiting claim and registrations awaiting device
  const awaitingCount = registrations.filter(r => r.status === 'awaiting_device').length;
  const pendingCount = pendingDevices.length;

  const activeSessionCount = sessions.filter(s => !s.closed_at).length;
  const deviceTotal = stats.total || totalDevices;

  const orgName =
    organizations.find(o => o.id === (selectedOrg || user.organization_id))?.name ||
    (user.role === 'SUPER_ADMIN' ? 'All customers' : 'Workspace');

  const viewTitles: Record<string, string> = {
    dashboard: 'Overview',
    devices: 'Devices',
    groups: 'Devices',
    'add-devices': 'Devices',
    'available-to-claim': 'Devices',
    'registration-requests': 'Devices',
    sessions: 'Sessions',
    tags: 'Customer tags',
    users: 'Users',
    'enrollment-tokens': 'Enrollment tokens',
    profiles: 'Monitoring templates',
    'audit-logs': 'Audit records',
    organizations: 'Customers',
    bundles: 'Collector bundles',
  };

  const crumb = selectedDevice ? (
    <>
      <span>Devices</span>
      <span className="mx-1.5 text-muted-foreground">/</span>
      <b>{selectedDevice.name || selectedDevice.serial_number}</b>
    </>
  ) : (
    <b>{viewTitles[view] || 'Overview'}</b>
  );

  const isDeviceTabView = (DEVICE_TAB_VIEWS as readonly string[]).includes(view);

  return (
    <>
      <AppShell
        user={user}
        orgName={orgName}
        organizations={organizations}
        selectedOrg={selectedOrg}
        onSelectOrg={orgId => {
          setSelectedOrg(orgId);
          setPage(1);
        }}
        currentView={view}
        onSelectView={viewKey => {
          setView(viewKey);
          setSelectedDevice(null);
          setPage(1);
        }}
        counts={{ devices: deviceTotal, sessions: activeSessionCount }}
        crumb={crumb}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={value => {
          setSearchQuery(value);
          setView('devices');
          setSelectedDevice(null);
          setPage(1);
        }}
        onRefresh={refreshData}
        refreshing={refreshing}
        onSignOut={handleSignOut}
        theme={theme}
        onToggleTheme={toggleTheme}
      >
        {globalError && (
          <div className="mx-6 mt-5 flex items-start justify-between gap-4 rounded-lg border border-down-border bg-down-bg px-3.5 py-3 text-[13px] text-down">
            <span>{globalError}</span>
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => setGlobalError('')}>Dismiss</button>
          </div>
        )}

        {selectedDevice ? (
          <div className="p-6">
            <DeviceDetail
              device={selectedDevice}
              user={user}
              onBack={() => {
                setSelectedDevice(null);
                refreshData();
              }}
              onRefreshDevice={refreshData}
            />
          </div>
        ) : view === 'dashboard' ? (
          <FleetOverview
            stats={stats}
            pendingCount={pendingCount}
            awaitingCount={awaitingCount}
            sessions={sessions}
            groups={groups}
            devices={devices}
            user={user}
            onNavigate={v => setView(v)}
            onSelectFilter={s => {
              setStatusFilter(s);
              setView('devices');
            }}
            onOpenLuCI={handleOpenLuCI}
            onOpenTerminal={handleOpenTerminal}
          />
        ) : isDeviceTabView ? (
          <DevicesArea
            user={user}
            currentView={view}
            onSelectView={v => {
              setView(v);
              setPage(1);
            }}
            counts={{
              devices: deviceTotal,
              groups: groups.length,
              awaiting: awaitingCount,
              unclaimed: pendingCount,
            }}
          >
            {view === 'devices' && (
              <DeviceList
                user={user}
                devices={devices}
                total={totalDevices}
                page={page}
                loading={loading || refreshing}
                tags={tags}
                searchQuery={searchQuery}
                selectedTag={selectedTag}
                statusFilter={statusFilter}
                onSearchChange={q => {
                  setSearchQuery(q);
                  setPage(1);
                }}
                onTagChange={t => {
                  setSelectedTag(t);
                  setPage(1);
                }}
                onStatusChange={s => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                onPageChange={setPage}
                onSelectDevice={setSelectedDevice}
                onOpenLuCI={handleOpenLuCI}
                onOpenTerminal={handleOpenTerminal}
              />
            )}
            {view === 'groups' && (
              <GroupsManager
                user={user}
                organizations={organizations}
                groups={groups}
                selectedOrg={selectedOrg}
                devices={devices}
                onRefresh={refreshData}
              />
            )}
            {view === 'add-devices' && (
              <AddDevices
                user={user}
                organizations={organizations}
                tags={tags}
                selectedOrg={selectedOrg}
                onSuccess={() => {
                  refreshData();
                  setView('registration-requests');
                }}
                onRefreshTags={refreshData}
              />
            )}
            {view === 'available-to-claim' && (
              <AvailableToClaim
                user={user}
                pendingDevices={pendingDevices}
                loading={loading || refreshing}
                tags={tags}
                selectedOrg={selectedOrg}
                onRefresh={refreshData}
              />
            )}
            {view === 'registration-requests' && (
              <RegistrationRequests
                user={user}
                registrations={registrations}
                loading={loading || refreshing}
                tags={tags}
                selectedOrg={selectedOrg}
                onRefresh={refreshData}
              />
            )}
          </DevicesArea>
        ) : (
          <div className="p-6">
            {view === 'tags' && (
              <TagsManager
                user={user}
                tags={tags}
                organizations={organizations}
                selectedOrg={selectedOrg}
                loading={loading || refreshing}
                onRefresh={refreshData}
              />
            )}
            {view === 'sessions' && (
              <SessionsManager
                user={user}
                sessions={sessions}
                devices={devices}
                loading={loading || refreshing}
                onRefresh={refreshData}
              />
            )}
            {['users', 'enrollment-tokens', 'organizations', 'profiles', 'bundles', 'audit-logs'].includes(view) && (
              <AdminViews
                view={view}
                currentUser={user}
                data={adminData}
                organizations={organizations}
                groups={groups}
                selectedOrg={selectedOrg}
                loading={loading || refreshing}
                onRefresh={refreshData}
              />
            )}
          </div>
        )}
      </AppShell>
      <Toaster />
    </>
  );
}
