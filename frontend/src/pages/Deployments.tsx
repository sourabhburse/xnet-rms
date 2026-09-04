import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Tabs,
  Progress,
  Modal,
  Form,
  Input,
  Select,
  Radio,
  message,
} from 'antd';
import {
  CloudUploadOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  FileZipOutlined,
} from '@ant-design/icons';

export const Deployments: React.FC = () => {
  const [activeTab, setActiveTab] = useState('rollouts');
  const [rolloutModalOpen, setRolloutModalOpen] = useState(false);
  const [uploadFwModalOpen, setUploadFwModalOpen] = useState(false);

  // Mock Rollouts Data
  const [rollouts, setRollouts] = useState([
    {
      id: 'rollout-01',
      name: 'Fleet Upgrade to Niseva v1.2 LTS',
      type: 'FIRMWARE',
      target_version: 'v1.2.0',
      strategy: 'CANARY_THEN_ALL',
      status: 'IN_PROGRESS',
      total_devices: 42,
      success_count: 38,
      failure_count: 1,
      progress: 90,
      created_at: '2026-09-02 22:30',
    },
    {
      id: 'rollout-02',
      name: 'Deploy niseva-agent 1.0.0-1',
      type: 'PACKAGE',
      target_version: '1.0.0-1',
      strategy: 'IMMEDIATE',
      status: 'COMPLETED',
      total_devices: 42,
      success_count: 42,
      failure_count: 0,
      progress: 100,
      created_at: '2026-09-01 14:15',
    },
  ]);

  // Mock Firmware Images Data
  const firmwareList = [
    {
      id: 'fw-01',
      name: 'OpenWrt 23.05.2 - Niseva v1.2 LTS',
      version: 'v1.2.0',
      hardware_model: 'Niseva 2S (MIPS 24Kc)',
      file_size_bytes: 14680064,
      checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      release_notes: 'Kernel security fixes, Parson JSON telemetry engine, strongSwan 5.9.11.',
      created_at: '2026-08-30',
    },
    {
      id: 'fw-02',
      name: 'OpenWrt 21.02.5 - Stable Release',
      version: 'v1.0.4',
      hardware_model: 'Niseva 2S (MIPS 24Kc)',
      file_size_bytes: 12582912,
      checksum_sha256: 'a6c5e87612f08a987d6541f87b640192e3c0919837190f845a908237410251f9',
      release_notes: 'Factory stable image for solar farm deployments.',
      created_at: '2026-08-01',
    },
  ];

  // Mock Software Packages Data
  const packageList = [
    {
      id: 'pkg-01',
      name: 'niseva-agent',
      version: '1.0.0-1',
      architecture: 'mips_24kc',
      file_size_bytes: 18432,
      description: 'Native C management agent with Parson JSON, failsafe watchdog, and RMS Connect.',
      created_at: '2026-09-02',
    },
    {
      id: 'pkg-02',
      name: 'modbus-master',
      version: '2.0-9',
      architecture: 'mips_24kc',
      file_size_bytes: 13433,
      description: 'Industrial Modbus RTU/TCP telemetry poller for solar inverters.',
      created_at: '2026-08-15',
    },
  ];

  const handleLaunchRollout = (values: any) => {
    const newRollout = {
      id: `rollout-${Date.now().toString().slice(-4)}`,
      name: values.name,
      type: values.type,
      target_version: values.target_version,
      strategy: values.strategy,
      status: 'IN_PROGRESS',
      total_devices: 42,
      success_count: 0,
      failure_count: 0,
      progress: 5,
      created_at: 'Just now',
    };
    setRollouts([newRollout, ...rollouts]);
    setRolloutModalOpen(false);
    message.success(`FOTA Rollout "${values.name}" launched successfully!`);
  };

  const rolloutColumns = [
    {
      title: 'Rollout Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <div>
          <strong style={{ color: '#111827', fontSize: 14 }}>{name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Target: <Tag color="blue">{record.target_version}</Tag> • {record.created_at}
          </div>
        </div>
      ),
    },
    {
      title: 'Type & Strategy',
      key: 'type_strat',
      render: (_: any, record: any) => (
        <Space direction="vertical" size={2}>
          {record.type === 'FIRMWARE' ? (
            <Tag color="purple">Sysupgrade Firmware</Tag>
          ) : (
            <Tag color="cyan">.IPK Package</Tag>
          )}
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {record.strategy === 'CANARY_THEN_ALL' ? 'Canary (10% First)' : 'Immediate All'}
          </span>
        </Space>
      ),
    },
    {
      title: 'Fleet Progress',
      key: 'progress',
      width: 260,
      render: (_: any, record: any) => (
        <div>
          <Progress
            percent={record.progress}
            size="small"
            status={record.status === 'COMPLETED' ? 'success' : 'active'}
          />
          <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', justifyContent: 'space-between' }}>
            <span>Success: <strong style={{ color: '#10b981' }}>{record.success_count}</strong></span>
            {record.failure_count > 0 && (
              <span>Failed: <strong style={{ color: '#ef4444' }}>{record.failure_count}</strong></span>
            )}
            <span>Total: {record.total_devices}</span>
          </div>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        if (status === 'COMPLETED') return <Tag icon={<CheckCircleOutlined />} color="success">COMPLETED</Tag>;
        if (status === 'IN_PROGRESS') return <Tag icon={<ClockCircleOutlined />} color="processing">DEPLOYING</Tag>;
        return <Tag color="error">{status}</Tag>;
      },
    },
  ];

  const firmwareColumns = [
    {
      title: 'Version & Name',
      key: 'version',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827' }}>{record.version}</strong> — {record.name}
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.release_notes}</div>
        </div>
      ),
    },
    {
      title: 'Target Hardware',
      dataIndex: 'hardware_model',
      key: 'hardware_model',
      render: (val: string) => <Tag color="default">{val}</Tag>,
    },
    {
      title: 'Image Size',
      dataIndex: 'file_size_bytes',
      key: 'file_size_bytes',
      render: (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
    },
    {
      title: 'SHA256 Checksum',
      dataIndex: 'checksum_sha256',
      key: 'checksum_sha256',
      render: (hash: string) => (
        <code style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
          {hash.substring(0, 16)}...
        </code>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: () => (
        <Button size="small" type="primary" ghost icon={<PlayCircleOutlined />} onClick={() => setRolloutModalOpen(true)}>
          Deploy
        </Button>
      ),
    },
  ];

  const packageColumns = [
    {
      title: 'Package',
      key: 'name',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827' }}>{record.name}</strong> <Tag color="blue">{record.version}</Tag>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.description}</div>
        </div>
      ),
    },
    {
      title: 'Architecture',
      dataIndex: 'architecture',
      key: 'architecture',
      render: (val: string) => <Tag color="geekblue">{val}</Tag>,
    },
    {
      title: 'Size',
      dataIndex: 'file_size_bytes',
      key: 'file_size_bytes',
      render: (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: () => (
        <Button size="small" type="primary" ghost icon={<PlayCircleOutlined />} onClick={() => setRolloutModalOpen(true)}>
          Push to Fleet
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: '#111827', fontWeight: 600 }}>Firmware & Package Rollouts</h2>
          <span style={{ color: '#6b7280', fontSize: 13 }}>
            FOTA Sysupgrade orchestration with canary verification and atomic rollbacks
          </span>
        </div>
        <Space>
          <Button icon={<CloudUploadOutlined />} onClick={() => setUploadFwModalOpen(true)}>
            Upload Firmware (.bin)
          </Button>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setRolloutModalOpen(true)}>
            + Launch Fleet Rollout
          </Button>
        </Space>
      </div>

      <Card bordered bodyStyle={{ padding: '8px 16px' }} style={{ borderColor: '#e5e7eb' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'rollouts',
              label: (
                <span>
                  <PlayCircleOutlined /> Active Rollouts ({rollouts.length})
                </span>
              ),
              children: (
                <Table
                  columns={rolloutColumns}
                  dataSource={rollouts}
                  rowKey="id"
                  pagination={false}
                />
              ),
            },
            {
              key: 'firmware',
              label: (
                <span>
                  <FileZipOutlined /> Firmware Images ({firmwareList.length})
                </span>
              ),
              children: (
                <Table
                  columns={firmwareColumns}
                  dataSource={firmwareList}
                  rowKey="id"
                  pagination={false}
                />
              ),
            },
            {
              key: 'packages',
              label: (
                <span>
                  <CodeOutlined /> Custom Packages ({packageList.length})
                </span>
              ),
              children: (
                <Table
                  columns={packageColumns}
                  dataSource={packageList}
                  rowKey="id"
                  pagination={false}
                />
              ),
            },
          ]}
        />
      </Card>

      {/* Launch Rollout Modal */}
      <Modal
        title="Launch Fleet Deployment Rollout"
        open={rolloutModalOpen}
        onCancel={() => setRolloutModalOpen(false)}
        footer={null}
        width={560}
      >
        <Form layout="vertical" onFinish={handleLaunchRollout} initialValues={{ type: 'FIRMWARE', target_version: 'v1.2.0', strategy: 'CANARY_THEN_ALL' }}>
          <Form.Item label="Rollout Name" name="name" rules={[{ required: true, message: 'Please enter rollout name' }]}>
            <Input placeholder="e.g. Solar Site Fleet Upgrade Q3" />
          </Form.Item>

          <Form.Item label="Deployment Type" name="type">
            <Radio.Group>
              <Radio.Button value="FIRMWARE">Sysupgrade Firmware (.bin)</Radio.Button>
              <Radio.Button value="PACKAGE">Custom Package (.ipk)</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item label="Target Version" name="target_version">
            <Select
              options={[
                { value: 'v1.2.0', label: 'OpenWrt 23.05.2 - Niseva v1.2 LTS (14.0 MB)' },
                { value: '1.0.0-1', label: 'niseva-agent 1.0.0-1_mips_24kc (18 KB)' },
                { value: '2.0-9', label: 'modbus-master 2.0-9_mips_24kc (13 KB)' },
              ]}
            />
          </Form.Item>

          <Form.Item label="Deployment Strategy" name="strategy">
            <Radio.Group>
              <Radio value="CANARY_THEN_ALL">
                <strong>Canary (10% Test Batch First)</strong>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Deploys to 4 canary routers first. Fleet proceeds automatically after 15 minutes of stable heartbeats.
                </div>
              </Radio>
              <Radio value="IMMEDIATE" style={{ marginTop: 10 }}>
                <strong>Immediate Fleet Rollout</strong>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Deploys concurrently to all 42 routers with staggered 5-second delays.
                </div>
              </Radio>
            </Radio.Group>
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <Button onClick={() => setRolloutModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit">
              Confirm & Dispatch Rollout
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Upload Firmware Modal */}
      <Modal
        title="Register New Firmware Image"
        open={uploadFwModalOpen}
        onCancel={() => setUploadFwModalOpen(false)}
        onOk={() => {
          message.success('Firmware registered successfully!');
          setUploadFwModalOpen(false);
        }}
        width={500}
      >
        <Form layout="vertical">
          <Form.Item label="Image Display Name" required>
            <Input placeholder="e.g. OpenWrt 23.05.3 - Niseva v1.3" />
          </Form.Item>
          <Form.Item label="Target Hardware Model" required>
            <Input defaultValue="Niseva 2S (MIPS 24Kc)" />
          </Form.Item>
          <Form.Item label="Version Tag" required>
            <Input placeholder="e.g. v1.3.0" />
          </Form.Item>
          <Form.Item label="SHA256 Checksum" required>
            <Input placeholder="64-character hex sha256 checksum" />
          </Form.Item>
          <Form.Item label="Download URL / Storage Key" required>
            <Input placeholder="http://82.180.146.203:8080/firmware/image.bin" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
