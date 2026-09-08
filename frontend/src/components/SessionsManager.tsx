import React, { useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DisconnectOutlined, ReloadOutlined } from '@ant-design/icons';
import { Device, SessionItem, User } from '../types';
import { api, formatApiError } from '../api';

interface SessionsManagerProps {
  user: User;
  sessions: SessionItem[];
  devices: Device[];
  loading: boolean;
  onRefresh: () => void;
}

export default function SessionsManager({
  user,
  sessions,
  devices,
  loading,
  onRefresh,
}: SessionsManagerProps) {
  const [closingId, setClosingId] = useState<string | null>(null);

  const handleCloseSession = (sessionId: string) => {
    Modal.confirm({
      title: 'Terminate remote session?',
      content: 'The active connection will be dropped immediately.',
      okText: 'Close Session',
      okType: 'danger',
      onOk: async () => {
        setClosingId(sessionId);
        try {
          await api(`sessions/${sessionId}`, 'DELETE');
          message.success('Session closed successfully');
          onRefresh();
        } catch (err) {
          const formatted = formatApiError(err);
          message.error(formatted.message);
        } finally {
          setClosingId(null);
        }
      },
    });
  };

  const getDeviceSerial = (deviceId: string) => {
    const d = devices.find(x => x.id === deviceId);
    return d ? d.serial_number : deviceId;
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-title">
            Active Remote Sessions
          </Typography.Title>
          <div className="page-subtitle">
            Currently active SSH tunnels and LuCI proxy sessions across your fleet (system capacity: 25 concurrent).
          </div>
        </div>

        <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
          Refresh
        </Button>
      </div>

      <Card className="rms-card" bordered={false}>
        <Table<SessionItem>
          rowKey="id"
          className="rms-table"
          loading={loading}
          dataSource={sessions}
          columns={[
            {
              title: 'Device Serial Number',
              dataIndex: 'device_id',
              key: 'device_id',
              render: (id: string) => (
                <span className="code-font" style={{ fontWeight: 600 }}>
                  {getDeviceSerial(id)}
                </span>
              ),
            },
            {
              title: 'Protocol',
              dataIndex: 'protocol',
              key: 'protocol',
              render: (p: string) => {
                let color = 'blue';
                if (p === 'SSH_LUCI') color = 'cyan';
                if (p === 'TERMINAL_SSH') color = 'purple';
                return <Tag color={color}>{p}</Tag>;
              },
            },
            {
              title: 'Session ID',
              dataIndex: 'id',
              key: 'id',
              render: (id: string) => (
                <span className="code-font" style={{ fontSize: 11, color: '#64748b' }}>
                  {id}
                </span>
              ),
            },
            {
              title: 'Expires At',
              dataIndex: 'expires_at',
              key: 'expires_at',
              render: (t: string) => (t ? new Date(t).toLocaleTimeString() : '—'),
            },
            {
              title: 'Actions',
              key: 'actions',
              render: (_, record: SessionItem) => (
                <Button
                  size="small"
                  danger
                  icon={<DisconnectOutlined />}
                  loading={closingId === record.id}
                  onClick={() => handleCloseSession(record.id)}
                >
                  Close Session
                </Button>
              ),
            },
          ]}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No active remote sessions currently open"
              />
            ),
          }}
        />
      </Card>
    </div>
  );
}
