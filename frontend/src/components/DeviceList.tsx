import React, { useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SearchOutlined,
  GlobalOutlined,
  CodeOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { Device, TagItem, User } from '../types';

interface DeviceListProps {
  user: User;
  devices: Device[];
  total: number;
  page: number;
  loading: boolean;
  tags: TagItem[];
  searchQuery: string;
  selectedTag: string;
  statusFilter: string;
  onSearchChange: (q: string) => void;
  onTagChange: (tag: string) => void;
  onStatusChange: (status: string) => void;
  onPageChange: (page: number) => void;
  onSelectDevice: (device: Device) => void;
  onOpenLuCI: (device: Device) => void;
  onOpenTerminal: (device: Device) => void;
}

export default function DeviceList({
  user,
  devices,
  total,
  page,
  loading,
  tags,
  searchQuery,
  selectedTag,
  statusFilter,
  onSearchChange,
  onTagChange,
  onStatusChange,
  onPageChange,
  onSelectDevice,
  onOpenLuCI,
  onOpenTerminal,
}: DeviceListProps) {
  const [searchInput, setSearchInput] = useState(searchQuery);
  const canOperate = user.role !== 'VIEWER';

  const renderStatus = (status: string) => {
    if (status === 'ONLINE') {
      return (
        <span className="status-pill status-online">
          <span className="status-dot" /> ONLINE
        </span>
      );
    }
    if (status === 'REVOKED') {
      return (
        <span className="status-pill status-revoked">
          <span className="status-dot" /> REVOKED
        </span>
      );
    }
    return (
      <span className="status-pill status-offline">
        <span className="status-dot" /> OFFLINE
      </span>
    );
  };

  const columns: ColumnsType<Device> = [
    {
      title: 'Device',
      key: 'device',
      render: (_, record: Device) => (
        <button type="button" className="device-identity" onClick={() => onSelectDevice(record)}>
          <span className="device-avatar" aria-hidden="true">{(record.name || record.model || 'R').slice(0, 1).toUpperCase()}</span>
          <span className="device-identity-copy">
            <strong>{record.name || 'Unnamed device'}</strong>
            <span className="code-font">{record.serial_number}</span>
          </span>
        </button>
      ),
    },
    {
      title: 'Model',
      dataIndex: 'model',
      key: 'model',
      render: (model: string, r: Device) => (
        <span className="device-model">
          <strong>{model || 'Niseva Router'}</strong>
          {r.firmware_version && (
            <span>Firmware v{r.firmware_version}</span>
          )}
        </span>
      ),
    },
    {
      title: 'Network identity',
      key: 'identity',
      render: (_, record: Device) => (
        <span className="device-network">
          <span className="code-font">{record.lan_mac || '—'}</span>
          <span>{record.last_seen ? new Date(record.last_seen).toLocaleString() : 'Never seen'}</span>
        </span>
      ),
    },
    {
      title: 'Tags & groups',
      key: 'labels',
      render: (_, record: Device) => (
        <Space size={[0, 4]} wrap>
          {(record.tags || []).map(t => <Tag key={`tag-${t}`}>{t}</Tag>)}
          {(record.groups || []).map(g => <Tag key={`group-${g}`} className="group-tag">{g}</Tag>)}
          {!(record.tags?.length || record.groups?.length) && <span className="muted-value">No labels</span>}
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: renderStatus,
    },
    {
      title: 'Last Seen',
      dataIndex: 'last_seen',
      key: 'last_seen',
      responsive: ['xl'],
      render: (time: string) => time ? <span className="last-seen">{new Date(time).toLocaleString()}</span> : <span className="muted-value">Never</span>,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record: Device) => (
        <Space size="small" className="device-actions">
          {canOperate && record.status === 'ONLINE' && (
            <>
              <Tooltip title="Open LuCI WebUI (Server-side SSH tunnel)">
                <Button
                  size="small"
                  icon={<GlobalOutlined />}
                  onClick={() => onOpenLuCI(record)}
                >
                  LuCI
                </Button>
              </Tooltip>
              <Tooltip title="Open Web Terminal">
                <Button
                  size="small"
                  icon={<CodeOutlined />}
                  onClick={() => onOpenTerminal(record)}
                >
                  CLI
                </Button>
              </Tooltip>
            </>
          )}
          <Button
            size="small"
            icon={<InfoCircleOutlined />}
            onClick={() => onSelectDevice(record)}
          >
            Details
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card className="rms-card" bordered={false}>
      <div className="fleet-toolbar">
        <div>
          <div className="rms-card-title">Fleet devices</div>
          <div className="rms-card-caption">{total} enrolled routers in this workspace</div>
        </div>
        <div className="filter-bar">
        <Input
          placeholder="Search fleet"
          prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onPressEnter={() => onSearchChange(searchInput)}
          onBlur={() => onSearchChange(searchInput)}
          style={{ width: 260 }}
          allowClear
        />

        <Select
          aria-label="Filter by tag"
          placeholder="Filter by Tag"
          allowClear
          value={selectedTag || undefined}
          onChange={val => onTagChange(val || '')}
          style={{ width: 200 }}
          options={(tags || []).map(t => ({ value: t.name, label: t.name }))}
        />

        <Select
          aria-label="Filter by connectivity status"
          placeholder="All Statuses"
          value={statusFilter}
          onChange={onStatusChange}
          style={{ width: 160 }}
          options={[
            { value: '', label: 'All Statuses' },
            { value: 'ONLINE', label: 'Online Only' },
            { value: 'OFFLINE', label: 'Offline Only' },
            { value: 'REVOKED', label: 'Revoked Only' },
          ]}
        />
        </div>
      </div>

      <Table<Device>
        rowKey="id"
        className="rms-table"
        columns={columns}
        dataSource={devices}
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          total,
          pageSize: 100,
          showSizeChanger: false,
          onChange: onPageChange,
          showTotal: t => `Total ${t} devices`,
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No devices match your search or filter"
            />
          ),
        }}
      />
    </Card>
  );
}
