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
import {
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Registration, TagItem, User } from '../types';
import { api, formatApiError } from '../api';

interface RegistrationRequestsProps {
  user: User;
  registrations: Registration[];
  loading: boolean;
  tags: TagItem[];
  selectedOrg: string;
  onRefresh: () => void;
}

export default function RegistrationRequests({
  user,
  registrations,
  loading,
  tags,
  selectedOrg,
  onRefresh,
}: RegistrationRequestsProps) {
  const [editingItem, setEditingItem] = useState<Registration | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const filteredRegistrations = (registrations || []).filter(
    r => !selectedOrg || r.organization_id === selectedOrg
  );

  const availableTags = (tags || []).filter(
    t => !editingItem || !editingItem.organization_id || t.organization_id === editingItem.organization_id
  );
  const tagOptions = availableTags.map(t => ({ label: t.name, value: t.name }));

  const openEditModal = (item: Registration) => {
    setEditingItem(item);
    setEditName(item.name || '');
    setEditTags(item.tags || []);
  };

  const handleEditSubmit = async () => {
    if (!editingItem) return;
    setSubmitting(true);
    try {
      await api(`registrations/${editingItem.id}`, 'PATCH', {
        name: editName.trim(),
        tags: editTags,
      });
      message.success('Registration updated successfully');
      setEditingItem(null);
      onRefresh();
    } catch (err) {
      const formatted = formatApiError(err);
      message.error(formatted.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRegistration = (item: Registration) => {
    Modal.confirm({
      title: 'Cancel this registration?',
      content: `Are you sure you want to cancel pre-registration for router ${item.serial_number}?`,
      okText: 'Cancel Registration',
      okType: 'danger',
      onOk: async () => {
        try {
          await api(`registrations/${item.id}`, 'DELETE');
          message.success('Registration cancelled');
          onRefresh();
        } catch (err) {
          const formatted = formatApiError(err);
          message.error(formatted.message);
        }
      },
    });
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-title">
            Pre-Registered Devices (Awaiting Connection)
          </Typography.Title>
          <div className="page-subtitle">
            Routers pre-registered by administrators that have not yet performed their initial boot check-in.
          </div>
        </div>

        <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
          Refresh
        </Button>
      </div>

      <Card className="rms-card" bordered={false}>
        <Table<Registration>
          rowKey="id"
          className="rms-table"
          loading={loading}
          dataSource={filteredRegistrations}
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
              title: 'Device Name',
              dataIndex: 'name',
              key: 'name',
              render: (n: string) => n || <span style={{ color: '#94a3b8' }}>—</span>,
            },
            {
              title: 'LAN MAC Address',
              dataIndex: 'lan_mac',
              key: 'lan_mac',
              render: (mac: string) => <span className="code-font">{mac}</span>,
            },
            {
              title: 'Tags',
              dataIndex: 'tags',
              key: 'tags',
              render: (itemTags: string[]) => (
                <Space wrap>
                  {itemTags && itemTags.length > 0 ? (
                    itemTags.map(t => (
                      <Tag color="blue" key={t}>
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
              title: 'Registration State',
              dataIndex: 'status',
              key: 'status',
              render: (status: string) => {
                if (status === 'awaiting_device') {
                  return (
                    <span className="status-pill status-awaiting">
                      <span className="status-dot" /> Awaiting Device
                    </span>
                  );
                }
                if (status === 'claimed') {
                  return (
                    <span className="status-pill status-online">
                      <span className="status-dot" /> Claimed / Enrolled
                    </span>
                  );
                }
                return (
                  <span className="status-pill status-offline">
                    <span className="status-dot" /> Canceled
                  </span>
                );
              },
            },
            {
              title: 'Created',
              dataIndex: 'created_at',
              key: 'created_at',
              render: (t: string) => (t ? new Date(t).toLocaleString() : '—'),
            },
            {
              title: 'Actions',
              key: 'actions',
              render: (_, record: Registration) => (
                <Space size="small">
                  {record.status === 'awaiting_device' && (
                    <>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEditModal(record)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleCancelRegistration(record)}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </Space>
              ),
            },
          ]}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No active pre-registration requests"
              />
            ),
          }}
        />
      </Card>

      {/* Edit Registration Modal */}
      <Modal
        title={`Edit Registration: ${editingItem?.serial_number}`}
        open={!!editingItem}
        onCancel={() => setEditingItem(null)}
        onOk={handleEditSubmit}
        confirmLoading={submitting}
        okText="Save Changes"
      >
        <div style={{ padding: '12px 0' }}>
          <Form layout="vertical">
            <Form.Item label="Device Friendly Name">
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                maxLength={128}
              />
            </Form.Item>

            <Form.Item label="Customer Tags">
              <Select
                mode="tags"
                value={editTags}
                onChange={setEditTags}
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
