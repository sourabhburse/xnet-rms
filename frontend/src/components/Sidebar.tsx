import React, { useState } from 'react';
import { Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  HddOutlined,
  PlusCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LinkOutlined,
  TagsOutlined,
  LineChartOutlined,
  TeamOutlined,
  KeyOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  CodeOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { User } from '../types';

interface SidebarProps {
  user: User;
  currentView: string;
  onSelectView: (viewKey: string) => void;
  pendingCount?: number;
  awaitingCount?: number;
}

export default function Sidebar({
  user,
  currentView,
  onSelectView,
  pendingCount = 0,
  awaitingCount = 0,
}: SidebarProps) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const isOrgAdmin = isSuperAdmin || user.role === 'ORG_ADMIN';
  const isOperator = isOrgAdmin || user.role === 'OPERATOR';

  type MenuItem = Required<MenuProps>['items'][number];
  const items: MenuItem[] = [];

  items.push({
    key: 'dashboard',
    icon: <DashboardOutlined />,
    label: 'Fleet Overview',
  });

  // Group 2: Devices
  const deviceChildren: MenuItem[] = [
    {
      key: 'devices',
      icon: <HddOutlined />,
      label: 'Device Fleet',
    },
    {
      key: 'groups',
      icon: <AppstoreOutlined />,
      label: 'Device Groups',
    },
  ];

  if (isOrgAdmin) {
    deviceChildren.push(
      {
        key: 'add-devices',
        icon: <PlusCircleOutlined />,
        label: 'Add Devices',
      },
      {
        key: 'available-to-claim',
        icon: <CheckCircleOutlined />,
        label: (
          <span>
            Available to Claim
            {pendingCount > 0 && (
              <span className="menu-count">
                {pendingCount}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'registration-requests',
        icon: <ClockCircleOutlined />,
        label: (
          <span>
            Awaiting Device
            {awaitingCount > 0 && (
              <span className="menu-count">
                {awaitingCount}
              </span>
            )}
          </span>
        ),
      }
    );
  }

  items.push({
    key: 'grp-devices',
    icon: <HddOutlined />,
    label: 'Device Management',
    children: deviceChildren,
  });

  // Group 3: Remote Access
  if (isOperator) {
    items.push({
      key: 'grp-remote',
      icon: <LinkOutlined />,
      label: 'Remote Access',
      children: [
        {
          key: 'sessions',
          icon: <LinkOutlined />,
          label: 'Remote Sessions',
        },
      ],
    });
  }

  // Group 4: Configuration
  const configChildren: MenuItem[] = [];
  if (isOrgAdmin) {
    configChildren.push({
      key: 'tags',
      icon: <TagsOutlined />,
      label: 'Customer Tags',
    });
  }
  configChildren.push({
    key: 'profiles',
    icon: <LineChartOutlined />,
    label: 'Monitoring Profiles',
  });

  items.push({
    key: 'grp-config',
    icon: <LineChartOutlined />,
    label: 'Configuration',
    children: configChildren,
  });

  // Group 5: Administration
  if (isOrgAdmin) {
    const adminChildren: MenuItem[] = [
      {
        key: 'users',
        icon: <TeamOutlined />,
        label: 'Users',
      },
      {
        key: 'enrollment-tokens',
        icon: <KeyOutlined />,
        label: 'Enrollment Tokens',
      },
      {
        key: 'audit-logs',
        icon: <FileTextOutlined />,
        label: 'Audit Records',
      },
    ];

    if (isSuperAdmin) {
      adminChildren.push(
        {
          key: 'organizations',
          icon: <ApartmentOutlined />,
          label: 'Customers',
        },
        {
          key: 'bundles',
          icon: <CodeOutlined />,
          label: 'Collector Bundles',
        }
      );
    }

    items.push({
      key: 'grp-admin',
      icon: <ApartmentOutlined />,
      label: 'Administration',
      children: adminChildren,
    });
  }

  const [openKeys, setOpenKeys] = useState<string[]>(['grp-devices', 'grp-remote']);

  return (
    <Layout.Sider
      width={252}
      breakpoint="lg"
      collapsedWidth={72}
      className="rms-sider"
    >
      <div className="rms-brand">
        <img src="/logo.png" alt="XNET RMS" />
        <h2>
          XNET RMS<span>v1.0</span>
        </h2>
      </div>
      <div className="rms-nav-label">Workspace</div>
      <Menu
        mode="inline"
        selectedKeys={[currentView]}
        openKeys={openKeys}
        items={items}
        onOpenChange={setOpenKeys}
        onClick={e => onSelectView(e.key)}
      />
    </Layout.Sider>
  );
}
