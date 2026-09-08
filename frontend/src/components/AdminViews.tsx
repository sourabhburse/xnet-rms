import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import {
  AuditRecord,
  CollectorBundle,
  DeviceGroup,
  EnrollmentToken,
  Organization,
  Profile,
  User,
} from '../types';
import { api, formatApiError } from '../api';

interface AdminViewsProps {
  view: string;
  currentUser: User;
  data: any[];
  organizations: Organization[];
  groups: DeviceGroup[];
  selectedOrg: string;
  loading: boolean;
  onRefresh: () => void;
}

export default function AdminViews({
  view,
  currentUser,
  data,
  organizations,
  groups,
  selectedOrg,
  loading,
  onRefresh,
}: AdminViewsProps) {
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [targetOrg, setTargetOrg] = useState(selectedOrg || currentUser.organization_id || '');
  const [userForm, setUserForm] = useState({ email: '', password: '', role: 'OPERATOR' });
  const [tokenForm, setTokenForm] = useState({ name: '', max_uses: 1, group_ids: [] as string[] });
  const [customerForm, setCustomerForm] = useState({ name: '' });
  const [rawJsonForm, setRawJsonForm] = useState('');
  const [createdTokenNotice, setCreatedTokenNotice] = useState<string | null>(null);

  useEffect(() => {
    if (selectedOrg) setTargetOrg(selectedOrg);
  }, [selectedOrg]);

  const openCreateModal = () => {
    setModalOpen(true);
    setCreatedTokenNotice(null);
    if (view === 'profiles') {
      setRawJsonForm(
        JSON.stringify(
          {
            version: 1,
            name: 'System Telemetry',
            source_id: 'system',
            type: 'ubus',
            object: 'system',
            method: 'info',
            interval_seconds: 60,
            timeout_seconds: 5,
            max_output_bytes: 32768,
            fields: [{ id: 'uptime', path: '/uptime', label: 'Uptime', unit: 's', kind: 'counter' }],
          },
          null,
          2
        )
      );
    } else if (view === 'bundles') {
      setRawJsonForm(
        JSON.stringify(
          {
            version: 1,
            script: "#!/bin/sh\nprintf '{\"status\":\"supported\"}\\n'\nexit 0\n",
          },
          null,
          2
        )
      );
    }
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      if (view === 'users') {
        if (!userForm.email || !userForm.password) {
          message.warning('Email and password required (password 12–72 chars).');
          setSubmitting(false);
          return;
        }
        await api('users', 'POST', {
          ...userForm,
          organization_id: targetOrg,
        });
        message.success('User created successfully');
      } else if (view === 'enrollment-tokens') {
        if (!tokenForm.name) {
          message.warning('Token name is required.');
          setSubmitting(false);
          return;
        }
        const res = await api<{ id: string; token: string }>('enrollment-tokens', 'POST', {
          ...tokenForm,
          organization_id: targetOrg,
          expires_at: null,
        });
        setCreatedTokenNotice(res.token);
        message.success('Enrollment token generated');
        onRefresh();
        setSubmitting(false);
        return;
      } else if (view === 'organizations') {
        if (!customerForm.name) {
          message.warning('Customer name is required.');
          setSubmitting(false);
          return;
        }
        await api('organizations', 'POST', customerForm);
        message.success('Customer organization created');
      } else if (view === 'profiles' || view === 'bundles') {
        const payload = JSON.parse(rawJsonForm);
        await api(view, 'POST', payload);
        message.success(`${view} created successfully`);
      }

      setModalOpen(false);
      onRefresh();
    } catch (err) {
      const formatted = formatApiError(err);
      message.error(formatted.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisableUser = (userId: string) => {
    Modal.confirm({
      title: 'Disable user account?',
      content: 'This user will be logged out and unable to access the RMS platform.',
      okText: 'Disable Account',
      okType: 'danger',
      onOk: async () => {
        try {
          await api(`users/${userId}/disable`, 'POST', {});
          message.success('User disabled');
          onRefresh();
        } catch (err) {
          const formatted = formatApiError(err);
          message.error(formatted.message);
        }
      },
    });
  };

  const handleRevokeToken = (tokenId: string) => {
    Modal.confirm({
      title: 'Revoke enrollment token?',
      content: 'Any pending routers using this token will no longer be allowed to auto-enroll.',
      okText: 'Revoke Token',
      okType: 'danger',
      onOk: async () => {
        try {
          await api(`enrollment-tokens/${tokenId}`, 'DELETE');
          message.success('Token revoked');
          onRefresh();
        } catch (err) {
          const formatted = formatApiError(err);
          message.error(formatted.message);
        }
      },
    });
  };

  // Render view-specific content
  if (view === 'users') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <Typography.Title level={3} className="page-title">
              User Accounts
            </Typography.Title>
            <div className="page-subtitle">
              Manage platform users, roles, and access permissions.
            </div>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateModal}
              style={{ background: '#0284c7', borderColor: '#0284c7' }}
            >
              Add User
            </Button>
          </Space>
        </div>

        <Card className="rms-card" bordered={false}>
          <Table<User>
            rowKey="id"
            className="rms-table"
            loading={loading}
            dataSource={data}
            columns={[
              { title: 'Email Address', dataIndex: 'email', key: 'email', render: e => <span style={{ fontWeight: 600 }}>{e}</span> },
              {
                title: 'Role',
                dataIndex: 'role',
                key: 'role',
                render: r => {
                  let c = 'default';
                  if (r === 'SUPER_ADMIN') c = 'magenta';
                  if (r === 'ORG_ADMIN') c = 'blue';
                  if (r === 'OPERATOR') c = 'cyan';
                  return <Tag color={c}>{r}</Tag>;
                },
              },
              {
                title: 'Status',
                dataIndex: 'disabled',
                key: 'disabled',
                render: disabled =>
                  disabled ? (
                    <Tag color="error">Disabled</Tag>
                  ) : (
                    <Tag color="success">Active</Tag>
                  ),
              },
              {
                title: 'Action',
                key: 'action',
                render: (_, r: User) => (
                  <Button
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    disabled={r.disabled || r.id === currentUser.id}
                    onClick={() => handleDisableUser(r.id)}
                  >
                    Disable
                  </Button>
                ),
              },
            ]}
          />
        </Card>

        <Modal
          title="Create User Account"
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          onOk={handleCreate}
          confirmLoading={submitting}
          okText="Create User"
        >
          <Form layout="vertical">
            {isSuperAdmin && (
              <Form.Item label="Customer Organization" required>
                <Select
                  placeholder="Select Customer Organization"
                  value={targetOrg || undefined}
                  onChange={setTargetOrg}
                  options={organizations.map(o => ({ value: o.id, label: o.name }))}
                />
              </Form.Item>
            )}
            <Form.Item label="Email Address" required>
              <Input
                type="email"
                placeholder="user@organization.com"
                value={userForm.email}
                onChange={e => setUserForm({ ...userForm, email: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="Initial Password (min 12 characters)" required>
              <Input.Password
                placeholder="Secure initial password"
                value={userForm.password}
                onChange={e => setUserForm({ ...userForm, password: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="Role" required>
              <Select
                value={userForm.role}
                onChange={v => setUserForm({ ...userForm, role: v })}
                options={[
                  { value: 'ORG_ADMIN', label: 'Organization Administrator (Full Org Access)' },
                  { value: 'OPERATOR', label: 'Operator (Device & Session Operations)' },
                  { value: 'VIEWER', label: 'Viewer (Read-only)' },
                ]}
              />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }

  if (view === 'enrollment-tokens') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <Typography.Title level={3} className="page-title">
              Enrollment Tokens
            </Typography.Title>
            <div className="page-subtitle">
              Pre-shared cryptographic tokens used by OpenWrt router daemons to auto-enroll into your customer fleet.
            </div>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateModal}
              style={{ background: '#0284c7', borderColor: '#0284c7' }}
            >
              Generate Token
            </Button>
          </Space>
        </div>

        <Card className="rms-card" bordered={false}>
          <Table<EnrollmentToken>
            rowKey="id"
            className="rms-table"
            loading={loading}
            dataSource={data}
            columns={[
              { title: 'Token Name / Purpose', dataIndex: 'name', key: 'name', render: n => <span style={{ fontWeight: 600 }}>{n}</span> },
              { title: 'Uses Count', key: 'uses', render: (_, r) => `${r.used_count} / ${r.max_uses ?? '∞'}` },
              {
                title: 'Status',
                dataIndex: 'revoked',
                key: 'revoked',
                render: revoked =>
                  revoked ? <Tag color="error">Revoked</Tag> : <Tag color="success">Active</Tag>,
              },
              {
                title: 'Action',
                key: 'action',
                render: (_, r: EnrollmentToken) => (
                  <Button
                    size="small"
                    danger
                    disabled={r.revoked}
                    onClick={() => handleRevokeToken(r.id)}
                  >
                    Revoke Token
                  </Button>
                ),
              },
            ]}
          />
        </Card>

        <Modal
          title={createdTokenNotice ? 'Copy Enrollment Token' : 'Generate Enrollment Token'}
          open={modalOpen}
          onCancel={() => {
            setModalOpen(false);
            setCreatedTokenNotice(null);
          }}
          footer={
            createdTokenNotice
              ? [
                  <Button
                    key="close"
                    type="primary"
                    onClick={() => {
                      setModalOpen(false);
                      setCreatedTokenNotice(null);
                    }}
                  >
                    Done
                  </Button>,
                ]
              : undefined
          }
          onOk={handleCreate}
          confirmLoading={submitting}
          okText="Generate Token"
        >
          {createdTokenNotice ? (
            <div>
              <Alert
                type="warning"
                showIcon
                message="Copy this token now"
                description="For security reasons, this token cannot be displayed again."
                style={{ marginBottom: 16 }}
              />
              <Typography.Paragraph
                copyable={{ text: createdTokenNotice }}
                code
                style={{ wordBreak: 'break-all', fontSize: 13 }}
              >
                {createdTokenNotice}
              </Typography.Paragraph>
            </div>
          ) : (
            <Form layout="vertical">
              {isSuperAdmin && (
                <Form.Item label="Customer Organization" required>
                  <Select
                    placeholder="Select Customer Organization"
                    value={targetOrg || undefined}
                    onChange={setTargetOrg}
                    options={organizations.map(o => ({ value: o.id, label: o.name }))}
                  />
                </Form.Item>
              )}
              <Form.Item label="Token Name / Label" required>
                <Input
                  placeholder="e.g. Batch-2S-2026-Warehouse"
                  value={tokenForm.name}
                  onChange={e => setTokenForm({ ...tokenForm, name: e.target.value })}
                />
              </Form.Item>
              <Form.Item label="Maximum Allowed Uses">
                <InputNumber
                  min={1}
                  max={10000}
                  value={tokenForm.max_uses}
                  onChange={v => setTokenForm({ ...tokenForm, max_uses: v || 1 })}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="Default device groups">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Optional groups applied on first claim"
                  value={tokenForm.group_ids}
                  onChange={v => setTokenForm({ ...tokenForm, group_ids: v })}
                  options={groups
                    .filter(g => !targetOrg || g.organization_id === targetOrg)
                    .map(g => ({ value: g.id, label: g.name }))}
                />
              </Form.Item>
            </Form>
          )}
        </Modal>
      </div>
    );
  }

  if (view === 'organizations') {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <Typography.Title level={3} className="page-title">
              Customer Organizations
            </Typography.Title>
            <div className="page-subtitle">
              Multi-tenant customer isolation boundaries.
            </div>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              Refresh
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateModal}
              style={{ background: '#0284c7', borderColor: '#0284c7' }}
            >
              Create Customer
            </Button>
          </Space>
        </div>

        <Card className="rms-card" bordered={false}>
          <Table<Organization>
            rowKey="id"
            className="rms-table"
            loading={loading}
            dataSource={data}
            columns={[
              { title: 'Customer Name', dataIndex: 'name', key: 'name', render: n => <span style={{ fontWeight: 600 }}>{n}</span> },
              { title: 'Organization ID', dataIndex: 'id', key: 'id', render: id => <span className="code-font" style={{ fontSize: 12, color: '#64748b' }}>{id}</span> },
            ]}
          />
        </Card>

        <Modal
          title="Create Customer Organization"
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          onOk={handleCreate}
          confirmLoading={submitting}
          okText="Create Customer"
        >
          <Form layout="vertical">
            <Form.Item label="Customer / Organization Name" required>
              <Input
                placeholder="e.g. Acme Corp Fleet"
                value={customerForm.name}
                maxLength={128}
                onChange={e => setCustomerForm({ name: e.target.value })}
              />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    );
  }

  if (view === 'profiles') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <Typography.Title level={3} className="page-title">
              Monitoring Profiles
            </Typography.Title>
            <div className="page-subtitle">
              Declarative telemetry definitions collected by router agents via OpenWrt ubus.
            </div>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              Refresh
            </Button>
            {isSuperAdmin && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateModal}
                style={{ background: '#0284c7', borderColor: '#0284c7' }}
              >
                Create Profile Version
              </Button>
            )}
          </Space>
        </div>

        <Card className="rms-card" bordered={false}>
          <Table<Profile>
            rowKey={r => `${r.id}-${r.version}`}
            className="rms-table"
            loading={loading}
            dataSource={data}
            columns={[
              { title: 'Profile Name', render: (_, r) => <span style={{ fontWeight: 600 }}>{r.definition?.name || r.id}</span> },
              { title: 'Source ID', render: (_, r) => <span className="code-font">{r.definition?.source_id}</span> },
              { title: 'Version', dataIndex: 'version', key: 'version', render: v => <Tag color="blue">v{v}</Tag> },
              { title: 'Poll Interval', render: (_, r) => `${r.definition?.interval_seconds ?? 60}s` },
              { title: 'Target Object / Method', render: (_, r) => `${r.definition?.object || 'system'} -> ${r.definition?.method || 'info'}` },
            ]}
          />
        </Card>

        <Modal
          title="Create Monitoring Profile Version (JSON)"
          open={modalOpen}
          width={650}
          onCancel={() => setModalOpen(false)}
          onOk={handleCreate}
          confirmLoading={submitting}
          okText="Create Profile"
        >
          <Input.TextArea
            rows={16}
            className="code-font"
            value={rawJsonForm}
            onChange={e => setRawJsonForm(e.target.value)}
          />
        </Modal>
      </div>
    );
  }

  if (view === 'audit-logs') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <Typography.Title level={3} className="page-title">
              Security Audit Records
            </Typography.Title>
            <div className="page-subtitle">
              Immutable audit trail of administrator and system actions.
            </div>
          </div>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
            Refresh
          </Button>
        </div>

        <Card className="rms-card" bordered={false}>
          <Table<AuditRecord>
            rowKey="id"
            className="rms-table"
            loading={loading}
            dataSource={data}
            columns={[
              { title: 'Timestamp', dataIndex: 'created_at', render: t => new Date(t).toLocaleString() },
              {
                title: 'Action',
                dataIndex: 'action',
                render: a => <Tag color="geekblue">{a}</Tag>,
              },
              { title: 'Target ID', dataIndex: 'target_id', render: id => <span className="code-font">{id}</span> },
              { title: 'Actor ID', dataIndex: 'actor_id', render: id => <span className="code-font">{id}</span> },
            ]}
          />
        </Card>
      </div>
    );
  }

  if (view === 'bundles') {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div className="page-header">
          <div>
            <Typography.Title level={3} className="page-title">
              Collector Bundles
            </Typography.Title>
            <div className="page-subtitle">
              Cryptographically signed shell collector packages deployed to router fleets.
            </div>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
              Refresh
            </Button>
            {isSuperAdmin && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateModal}
                style={{ background: '#0284c7', borderColor: '#0284c7' }}
              >
                Publish Bundle
              </Button>
            )}
          </Space>
        </div>

        <Card className="rms-card" bordered={false}>
          <Table<CollectorBundle>
            rowKey={r => `${r.id}-${r.version}`}
            className="rms-table"
            loading={loading}
            dataSource={data}
            columns={[
              { title: 'Bundle ID', dataIndex: 'id', render: id => <span className="code-font">{id}</span> },
              { title: 'Version', dataIndex: 'version', render: v => <Tag color="blue">v{v}</Tag> },
              { title: 'Created', dataIndex: 'created_at', render: t => (t ? new Date(t).toLocaleString() : '—') },
            ]}
          />
        </Card>

        <Modal
          title="Publish Collector Bundle (JSON)"
          open={modalOpen}
          width={650}
          onCancel={() => setModalOpen(false)}
          onOk={handleCreate}
          confirmLoading={submitting}
          okText="Publish Bundle"
        >
          <Input.TextArea
            rows={14}
            className="code-font"
            value={rawJsonForm}
            onChange={e => setRawJsonForm(e.target.value)}
          />
        </Modal>
      </div>
    );
  }

  return <div>Select a view from the sidebar navigation.</div>;
}
