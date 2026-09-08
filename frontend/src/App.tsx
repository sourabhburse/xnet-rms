import React, { useEffect, useState } from 'react';
import { Alert, Layout, Modal, message } from 'antd';
import './rms.css';
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
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import StatsBar from './components/StatsBar';
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

  // Fleet & Device data
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
      message.loading({ content: `Initiating LuCI session for ${dev.serial_number}...`, key: 'luci' });
      const session = await api<{ id: string; expires_at: string; launch_url: string }>(
        'sessions',
        'POST',
        { device_id: dev.id, protocol: 'SSH_LUCI' }
      );
      message.success({ content: 'LuCI session authorized!', key: 'luci' });
      window.open(session.launch_url, '_blank');
      refreshData();
    } catch (err) {
      const formatted = formatApiError(err);
      message.destroy('luci');
      Modal[formatted.type === 'error' ? 'error' : 'warning']({
        title: formatted.title,
        content: formatted.message,
      });
    }
  };

  // Remote Web Terminal Launcher (TERMINAL_SSH)
  const handleOpenTerminal = async (dev: Device) => {
    try {
      message.loading({ content: `Opening terminal for ${dev.serial_number}...`, key: 'term' });
      const session = await api<{ id: string; expires_at: string; launch_url: string }>(
        'sessions',
        'POST',
        { device_id: dev.id, protocol: 'TERMINAL_SSH' }
      );
      message.success({ content: 'Terminal session authorized!', key: 'term' });
      window.open(session.launch_url, '_blank');
      refreshData();
    } catch (err) {
      const formatted = formatApiError(err);
      message.destroy('term');
      Modal.error({
        title: formatted.title,
        content: formatted.message,
      });
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f3f3f3' }}>
        <p style={{ color: '#696969' }}>Loading XNET RMS...</p>
      </div>
    );
  }

  if (!user) {
    return <Login onLoginSuccess={setUser} api={api} />;
  }

  // Count pending devices awaiting claim and registrations awaiting device
  const awaitingCount = registrations.filter(r => r.status === 'awaiting_device').length;
  const pendingCount = pendingDevices.length;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar
        user={user}
        currentView={view}
        onSelectView={viewKey => {
          setView(viewKey);
          setSelectedDevice(null);
          setPage(1);
        }}
        pendingCount={pendingCount}
        awaitingCount={awaitingCount}
      />

      <Layout style={{ background: '#f3f3f3' }}>
        <Navbar
          user={user}
          organizations={organizations}
          selectedOrg={selectedOrg}
          onSelectOrg={orgId => {
            setSelectedOrg(orgId);
            setPage(1);
          }}
          onRefresh={refreshData}
          refreshing={refreshing}
          onSignOut={handleSignOut}
          searchQuery={searchQuery}
          onSearchChange={value => setSearchQuery(value)}
          onSearchSubmit={value => {
            setSearchQuery(value);
            setView('devices');
            setSelectedDevice(null);
            setPage(1);
          }}
        />

        <Layout.Content className="rms-content">
          {globalError && (
            <Alert
              type="error"
              message={globalError}
              showIcon
              closable
              style={{ marginBottom: 20 }}
              onClose={() => setGlobalError('')}
            />
          )}

          {/* If a device is selected, show detail view */}
          {selectedDevice ? (
            <DeviceDetail
              device={selectedDevice}
              user={user}
              onBack={() => {
                setSelectedDevice(null);
                refreshData();
              }}
              onRefreshDevice={refreshData}
            />
          ) : (
            <>
              {/* Dashboard / Fleet Overview */}
              {view === 'dashboard' && (
                <div>
                  <div className="page-header">
                    <div>
                      <h1 className="page-title">Fleet Overview</h1>
                      <div className="page-subtitle">Real-time status and telemetry of deployed router fleet.</div>
                    </div>
                  </div>

                  <StatsBar
                    stats={stats}
                    pendingCount={pendingCount}
                    awaitingCount={awaitingCount}
                    onSelectFilter={setStatusFilter}
                    onNavigate={v => setView(v)}
                  />

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
                </div>
              )}

              {/* Device Fleet View */}
              {view === 'devices' && (
                <div>
                  <div className="page-header">
                    <div>
                      <h1 className="page-title">Device Fleet Inventory</h1>
                      <div className="page-subtitle">All enrolled routers reporting telemetry to RMS.</div>
                    </div>
                  </div>

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
                </div>
              )}

              {/* Add Devices */}
              {view === 'groups' && (
                <GroupsManager
                  user={user}
                  organizations={organizations}
                  selectedOrg={selectedOrg}
                  groups={groups}
                  devices={devices}
                  onRefresh={refreshData}
                />
              )}

              {/* Add Devices */}
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

              {/* Available to Claim */}
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

              {/* Registration Requests */}
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

              {/* Customer Tags */}
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

              {/* Remote Sessions */}
              {view === 'sessions' && (
                <SessionsManager
                  user={user}
                  sessions={sessions}
                  devices={devices}
                  loading={loading || refreshing}
                  onRefresh={refreshData}
                />
              )}

              {/* Admin Views */}
              {['users', 'enrollment-tokens', 'organizations', 'profiles', 'bundles', 'audit-logs'].includes(view) && (
                <AdminViews
                  view={view}
                  currentUser={user}
                  data={adminData}
                  organizations={organizations}
                  selectedOrg={selectedOrg}
                  loading={loading || refreshing}
                  onRefresh={refreshData}
                />
              )}
            </>
          )}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
