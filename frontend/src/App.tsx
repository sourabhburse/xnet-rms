import React, { useState } from 'react';
import { Layout, Menu, Typography, Badge, Space, Dropdown, Avatar, Tag, message } from 'antd';
import {
  DashboardOutlined,
  CloudServerOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  AppstoreOutlined,
  BellOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Dashboard } from './pages/Dashboard';
import { DeviceList } from './pages/DeviceList';
import { DeviceDetail } from './pages/DeviceDetail';
import { RmsConnect } from './pages/RmsConnect';
import { ConfigProfiles } from './pages/ConfigProfiles';
import { Deployments } from './pages/Deployments';
import { Alerts } from './pages/Alerts';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';

const { Header, Sider, Content } = Layout;

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('xnet_rms_user');
    const token = localStorage.getItem('niseva_token') || localStorage.getItem('token');
    return saved && token ? JSON.parse(saved) : null;
  });

  const [currentView, setCurrentView] = useState<
    'dashboard' | 'devices' | 'detail' | 'connect' | 'configs' | 'deployments' | 'alerts' | 'settings'
  >('dashboard');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [collapsed, setCollapsed] = useState(false);

  const handleSelectDevice = (id: string) => {
    setSelectedDeviceId(id);
    setCurrentView('detail');
  };

  const handleLogout = () => {
    localStorage.removeItem('xnet_rms_user');
    localStorage.removeItem('niseva_user');
    localStorage.removeItem('niseva_token');
    localStorage.removeItem('token');
    setCurrentUser(null);
    setCurrentView('dashboard');
    message.info('You have logged out of XNET Cloud RMS.');
  };

  // If user is not logged in, show the Login screen
  if (!currentUser) {
    return <Login onLoginSuccess={(user) => setCurrentUser(user)} />;
  }

  const navItems = [
    { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    { key: 'devices', icon: <CloudServerOutlined />, label: 'Devices (Routers & Gateways)' },
    { key: 'connect', icon: <ThunderboltOutlined />, label: 'RMS Connect' },
    { key: 'configs', icon: <SettingOutlined />, label: 'Config Profiles' },
    { key: 'deployments', icon: <AppstoreOutlined />, label: 'FOTA & Packages' },
    { key: 'alerts', icon: <BellOutlined />, label: 'Alerts & Rules' },
    { key: 'settings', icon: <SafetyCertificateOutlined />, label: 'Tenant & Security' },
  ];

  return (
    <Layout style={{ minHeight: '100vh', backgroundColor: '#f4f5f7' }}>
      {/* Brand Slate Sidebar (#1f2937) */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(val) => setCollapsed(val)}
        width={220}
        style={{
          backgroundColor: '#1f2937',
          borderRight: '1px solid #111827',
        }}
      >
        <div
          style={{
            padding: '16px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid #374151',
          }}
        >
          <img
            src="/logo.png"
            alt="XNET Logo"
            style={{
              height: 36,
              maxWidth: collapsed ? 36 : 110,
              objectFit: 'contain',
            }}
          />
          {!collapsed && (
            <span
              style={{
                color: '#2e90fa',
                fontWeight: 800,
                fontSize: 17,
                letterSpacing: 1,
              }}
            >
              RMS
            </span>
          )}
        </div>

        <Menu
          theme="dark"
          selectedKeys={[currentView === 'detail' ? 'devices' : currentView]}
          mode="inline"
          items={navItems}
          onClick={({ key }) => {
            if (
              key === 'dashboard' ||
              key === 'devices' ||
              key === 'connect' ||
              key === 'configs' ||
              key === 'deployments' ||
              key === 'alerts' ||
              key === 'settings'
            ) {
              setCurrentView(key as any);
            }
          }}
          style={{ backgroundColor: '#1f2937', borderRight: 'none', marginTop: 8 }}
        />
      </Sider>

      {/* Clean Light Layout Area */}
      <Layout style={{ backgroundColor: '#f4f5f7' }}>
        {/* Top Crisp White Header */}
        <Header
          style={{
            padding: '0 24px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            height: 60,
          }}
        >
          {/* Tenant Indicator */}
          <Space size={16}>
            <Tag color="blue" style={{ fontSize: 13, padding: '4px 10px', borderRadius: 4 }}>
              Tenant: <strong>{currentUser.organization || 'Acme Solar Corp'}</strong>
            </Tag>
            <Badge
              status="processing"
              text={<span style={{ color: '#10b981', fontWeight: 500 }}>Live MQTT Gateway</span>}
            />
          </Space>

          {/* User & Active Tunnels */}
          <Space size={16}>
            <Tag
              icon={<ThunderboltOutlined />}
              color="orange"
              style={{ borderRadius: 4, cursor: 'pointer' }}
              onClick={() => setCurrentView('connect')}
            >
              3 Active Tunnels
            </Tag>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'profile',
                    label: 'Organization Settings',
                    onClick: () => setCurrentView('settings'),
                  },
                  {
                    key: 'license',
                    label: 'License: Enterprise (500 Nodes)',
                    onClick: () => setCurrentView('settings'),
                  },
                  { type: 'divider' },
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: 'Log Out',
                    danger: true,
                    onClick: handleLogout,
                  },
                ],
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} style={{ backgroundColor: '#2e90fa' }} />
                <span style={{ color: '#111827', fontWeight: 500 }}>
                  {currentUser.name} ({currentUser.role === 'SUPER_ADMIN' ? 'Superadmin' : 'Org Admin'})
                </span>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* Content Area */}
        <Content style={{ padding: 24, margin: 0, minHeight: 280, backgroundColor: '#f4f5f7' }}>
          {currentView === 'dashboard' && <Dashboard onSelectDevice={handleSelectDevice} />}
          {currentView === 'devices' && <DeviceList onSelectDevice={handleSelectDevice} />}
          {currentView === 'detail' && (
            <DeviceDetail deviceId={selectedDeviceId} onBack={() => setCurrentView('devices')} />
          )}
          {currentView === 'connect' && <RmsConnect />}
          {currentView === 'configs' && <ConfigProfiles />}
          {currentView === 'deployments' && <Deployments />}
          {currentView === 'alerts' && <Alerts />}
          {currentView === 'settings' && <Settings />}
        </Content>
      </Layout>
    </Layout>
  );
};

export default App;
