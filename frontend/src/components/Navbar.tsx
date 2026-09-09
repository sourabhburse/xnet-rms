import React from 'react';
import { Button, Input, Select, Space, Tag, Tooltip } from 'antd';
import {
  ReloadOutlined,
  LogoutOutlined,
  UserOutlined,
  BankOutlined,
  SearchOutlined,
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
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (value: string) => void;
}

export default function Navbar({
  user,
  organizations,
  selectedOrg,
  onSelectOrg,
  onRefresh,
  refreshing,
  onSignOut,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
}: NavbarProps) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  return (
    <header className="rms-navbar">
      <div className="rms-nav-left">
        <Input.Search
          aria-label="Search devices"
          className="global-search"
          placeholder="Search devices, serials or MAC addresses"
          prefix={<SearchOutlined />}
          value={searchQuery}
          allowClear
          onChange={e => onSearchChange(e.target.value)}
          onSearch={onSearchSubmit}
        />
        {isSuperAdmin && (
          <Space className="org-switcher" size={8}>
            <BankOutlined />
            <Select
              aria-label="Filter by organization"
              placeholder="All Customers"
              allowClear
              value={selectedOrg || undefined}
              onChange={val => onSelectOrg(val || '')}
              style={{ width: 230 }}
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
            className="nav-refresh"
            icon={<ReloadOutlined spin={refreshing} />}
            onClick={onRefresh}
            disabled={refreshing}
          >
            Refresh
          </Button>
        </Tooltip>

        <div className="user-badge" title={user.email}>
          <UserOutlined />
          <span className="user-email">{user.email}</span>
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
