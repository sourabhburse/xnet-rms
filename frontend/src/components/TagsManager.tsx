import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
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
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Organization, TagItem, User } from '../types';
import { api, formatApiError } from '../api';

interface TagsManagerProps {
  user: User;
  tags: TagItem[];
  organizations: Organization[];
  selectedOrg: string;
  loading: boolean;
  onRefresh: () => void;
}

export default function TagsManager({
  user,
  tags,
  organizations,
  selectedOrg,
  loading,
  onRefresh,
}: TagsManagerProps) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const [modalOpen, setModalOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [targetOrg, setTargetOrg] = useState(selectedOrg || user.organization_id || '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (selectedOrg) setTargetOrg(selectedOrg);
  }, [selectedOrg]);

  const filteredTags = (tags || []).filter(
    t => !selectedOrg || t.organization_id === selectedOrg
  );

  const handleCreateTag = async () => {
    if (!tagName.trim()) {
      message.warning('Tag name cannot be empty.');
      return;
    }
    if (!targetOrg) {
      message.warning('Please select an organization.');
      return;
    }

    setSubmitting(true);
    try {
      await api('tags', 'POST', {
        name: tagName.trim(),
        organization_id: targetOrg,
      });
      message.success(`Tag "${tagName.trim()}" created successfully!`);
      setTagName('');
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      const formatted = formatApiError(err);
      message.error(formatted.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-title">
            Customer-Scoped Tags
          </Typography.Title>
          <div className="page-subtitle">
            Create tags to categorize routers by location, department, or deployment type.
          </div>
        </div>

        <Space>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
            style={{ background: '#0284c7', borderColor: '#0284c7' }}
          >
            Create New Tag
          </Button>
        </Space>
      </div>

      <Card className="rms-card" bordered={false}>
        <Table<TagItem>
          rowKey="id"
          className="rms-table"
          loading={loading}
          dataSource={filteredTags}
          columns={[
            {
              title: 'Tag Preview',
              dataIndex: 'name',
              key: 'name',
              render: (name: string) => (
                <Tag color="blue" style={{ fontSize: 13, padding: '2px 10px', borderRadius: 4 }}>
                  {name}
                </Tag>
              ),
            },
            {
              title: 'Tag Name',
              dataIndex: 'name',
              key: 'raw_name',
              render: (n: string) => <span style={{ fontWeight: 600 }}>{n}</span>,
            },
            {
              title: 'Organization ID',
              dataIndex: 'organization_id',
              key: 'organization_id',
              render: (orgId: string) => {
                const orgObj = organizations.find(o => o.id === orgId);
                return <span>{orgObj ? orgObj.name : orgId}</span>;
              },
            },
          ]}
        />
      </Card>

      <Modal
        title="Create New Customer Tag"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleCreateTag}
        confirmLoading={submitting}
        okText="Create Tag"
      >
        <div style={{ padding: '12px 0' }}>
          <Form layout="vertical">
            {isSuperAdmin && (
              <Form.Item label="Target Customer Organization" required>
                <Select
                  placeholder="Select Customer Organization"
                  value={targetOrg || undefined}
                  onChange={setTargetOrg}
                  options={organizations.map(o => ({ value: o.id, label: o.name }))}
                />
              </Form.Item>
            )}

            <Form.Item label="Tag Name" required>
              <Input
                placeholder="e.g. warehouse-ny, retail, energy-backup"
                value={tagName}
                maxLength={64}
                onChange={e => setTagName(e.target.value)}
                autoFocus
              />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
