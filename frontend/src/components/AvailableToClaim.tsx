import React, { useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { PendingDevice, TagItem, User } from '../types';
import { api, formatApiError } from '../api';

interface AvailableToClaimProps {
  user: User;
  pendingDevices: PendingDevice[];
  loading: boolean;
  tags: TagItem[];
  selectedOrg: string;
  onRefresh: () => void;
}

export default function AvailableToClaim({
  user,
  pendingDevices,
  loading,
  tags,
  selectedOrg,
  onRefresh,
}: AvailableToClaimProps) {
  const [claimingDevice, setClaimingDevice] = useState<PendingDevice | null>(null);
  const [claimName, setClaimName] = useState('');
  const [claimTags, setClaimTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Filter pending devices by selected organization if applicable
  const filteredDevices = (pendingDevices || []).filter(
    d => !selectedOrg || d.organization_id === selectedOrg
  );

  const availableTags = (tags || []).filter(
    t => !claimingDevice || !claimingDevice.organization_id || t.organization_id === claimingDevice.organization_id
  );
  const tagOptions = availableTags.map(t => ({ label: t.name, value: t.name }));

  const openClaimModal = (device: PendingDevice) => {
    setClaimingDevice(device);
    setClaimName('');
    setClaimTags([]);
  };

  const handleClaimSubmit = async () => {
    if (!claimingDevice) return;
    setSubmitting(true);
    try {
      await api(`pending-devices/${claimingDevice.id}/claim`, 'POST', {
        name: claimName.trim(),
        tags: claimTags,
      });
      message.success(`Device ${claimingDevice.serial_number} claimed successfully!`);
      setClaimingDevice(null);
      onRefresh();
    } catch (err) {
      const formatted = formatApiError(err);
      message.error(formatted.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-title">
            Devices Available to Claim
          </Typography.Title>
          <div className="page-subtitle">
            Routers that connected using an enrollment token or factory challenge and are waiting to be claimed into your organization.
          </div>
        </div>

        <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
          Refresh
        </Button>
      </div>

      <Card className="rms-card" bordered={false}>
        <Table<PendingDevice>
          rowKey="id"
          className="rms-table"
          loading={loading}
          dataSource={filteredDevices}
          columns={[
            {
              title: 'Serial Number',
              dataIndex: 'serial_number',
              key: 'serial_number',
              render: (s: string) => (
                <span className="code-font" style={{ fontWeight: 600 }}>
                  {s}
                </span>
              ),
            },
            {
              title: 'LAN MAC Address',
              dataIndex: 'lan_mac',
              key: 'lan_mac',
              render: (mac: string) => <span className="code-font">{mac}</span>,
            },
            {
              title: 'Model',
              dataIndex: 'model',
              key: 'model',
              render: (m: string) => m || 'Niseva 2S Router',
            },
            {
              title: 'Status',
              key: 'status',
              render: () => (
                <span className="status-pill status-pending">
                  <span className="status-dot" /> Available to Claim
                </span>
              ),
            },
            {
              title: 'Last Active',
              dataIndex: 'last_seen',
              key: 'last_seen',
              render: (t: string) => (t ? new Date(t).toLocaleString() : '—'),
            },
            {
              title: 'Action',
              key: 'action',
              render: (_, record: PendingDevice) => (
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  onClick={() => openClaimModal(record)}
                  style={{ background: '#7c3aed', borderColor: '#7c3aed' }}
                >
                  Claim Device
                </Button>
              ),
            },
          ]}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No devices currently awaiting claim"
              />
            ),
          }}
        />
      </Card>

      {/* Claim Device Modal */}
      <Modal
        title={`Claim Router: ${claimingDevice?.serial_number}`}
        open={!!claimingDevice}
        onCancel={() => setClaimingDevice(null)}
        onOk={handleClaimSubmit}
        confirmLoading={submitting}
        okText="Confirm & Claim"
      >
        <div style={{ padding: '12px 0' }}>
          <Typography.Paragraph type="secondary">
            Assign an optional friendly name and tags to enroll this router into your fleet.
          </Typography.Paragraph>

          <Form layout="vertical">
            <Form.Item label="Device Friendly Name">
              <Input
                placeholder="e.g. Branch Office Router"
                value={claimName}
                onChange={e => setClaimName(e.target.value)}
                maxLength={128}
              />
            </Form.Item>

            <Form.Item label="Customer Tags">
              <Select
                mode="tags"
                placeholder="Select or type new tags"
                value={claimTags}
                onChange={setClaimTags}
                options={tagOptions}
                style={{ width: '100%' }}
              />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
