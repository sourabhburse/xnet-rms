import React from 'react';
import { Button, Select, Space, Tag, Tooltip } from 'antd';
import {
  ReloadOutlined,
  LogoutOutlined,
  UserOutlined,
  BankOutlined,
} from '@ant-design/icons';
import { User, Organization } from '../types';

interface NavbarProps {
  user: User;
  organizations: Organization[];
  selectedOrg: string;
  onSelectOrg: (orgId: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onSignOut: () => void;
}

export default function Navbar({
  user,
  organizations,
  selectedOrg,
  onSelectOrg,
  onRefresh,
  refreshing,
  onSignOut,
}: NavbarProps) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  return (
    <header className="rms-navbar">
      <div className="rms-nav-left">
        {isSuperAdmin && (
          <Space>
            <BankOutlined />
            <Select
              aria-label="Filter by organization"
              placeholder="All Customers"
              allowClear
              value={selectedOrg || undefined}
              onChange={val => onSelectOrg(val || '')}
              style={{ width: 240 }}
              options={[
                { value: '', label: 'All Customers (Platform)' },
                ...(organizations || []).map(org => ({
                  value: org.id,
                  label: org.name,
                })),
              ]}
            />
          </Space>
        )}
      </div>

      <div className="rms-nav-right">
        <Tooltip title="Refresh data">
          <Button
            icon={<ReloadOutlined spin={refreshing} />}
            onClick={onRefresh}
            disabled={refreshing}
          >
            Refresh
          </Button>
        </Tooltip>

        <div className="user-badge">
          <UserOutlined />
          <span>{user.email}</span>
          <Tag style={{ margin: 0 }}>
            {user.role}
          </Tag>
        </div>

        <Button
          danger
          type="text"
          icon={<LogoutOutlined />}
          onClick={onSignOut}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
