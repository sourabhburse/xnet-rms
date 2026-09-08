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
      title: 'Serial Number',
      dataIndex: 'serial_number',
      key: 'serial_number',
      render: (serial: string, record: Device) => (
        <Button
          type="link"
          style={{ padding: 0, fontWeight: 600 }}
          className="code-font"
          onClick={() => onSelectDevice(record)}
        >
          {serial}
        </Button>
      ),
    },
    {
      title: 'Device Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (name ? <span>{name}</span> : <span style={{ color: '#94a3b8' }}>—</span>),
    },
    {
      title: 'LAN MAC',
      dataIndex: 'lan_mac',
      key: 'lan_mac',
      render: (mac: string) => (
        <span className="code-font" style={{ color: '#475569' }}>
          {mac || '—'}
        </span>
      ),
    },
    {
      title: 'Model',
      dataIndex: 'model',
      key: 'model',
      render: (model: string, r: Device) => (
        <span>
          {model || 'Niseva Router'}{' '}
          {r.firmware_version && (
            <span style={{ fontSize: 11, color: '#64748b' }}>v{r.firmware_version}</span>
          )}
        </span>
      ),
    },
    {
      title: 'Tags',
      dataIndex: 'tags',
      key: 'tags',
      render: (itemTags: string[]) => (
        <Space size={[0, 4]} wrap>
          {itemTags && itemTags.length > 0 ? (
            itemTags.map(t => (
              <Tag color="blue" key={t} style={{ fontSize: 11, borderRadius: 4 }}>
                {t}
              </Tag>
            ))
          ) : (
            <span style={{ color: '#94a3b8', fontSize: 12 }}>None</span>
          )}
        </Space>
      ),
    },
    {
      title: 'Groups',
      dataIndex: 'groups',
      key: 'groups',
      render: (itemGroups: string[]) => (
        <Space size={[0, 4]} wrap>
          {itemGroups && itemGroups.length > 0 ? itemGroups.map(g => (
            <Tag color="geekblue" key={g} style={{ fontSize: 11, borderRadius: 4 }}>{g}</Tag>
          )) : <span style={{ color: '#94a3b8', fontSize: 12 }}>None</span>}
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
      render: (time: string) =>
        time ? (
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {new Date(time).toLocaleString()}
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>Never</span>
        ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record: Device) => (
        <Space size="small">
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
      <div className="filter-bar">
        <Input
          placeholder="Search by serial number..."
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
