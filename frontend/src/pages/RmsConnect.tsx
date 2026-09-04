import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Button,
  Tag,
  Space,
  Form,
  Select,
  Input,
  Radio,
  Modal,
  Badge,
  message,
} from 'antd';
import {
  ThunderboltOutlined,
  GlobalOutlined,
  CodeOutlined,
  FolderOutlined,
  PlusOutlined,
  StopOutlined,
  CheckCircleFilled,
  LinkOutlined,
  SafetyCertificateOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { LuciModal } from '../components/LuciModal';
import { TerminalModal } from '../components/TerminalModal';
import { FileManagerModal } from '../components/FileManagerModal';

export const RmsConnect: React.FC = () => {
  const [luciOpen, setLuciOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [activeTunnelToken, setActiveTunnelToken] = useState('mock_token');
  const [activeDeviceName, setActiveDeviceName] = useState('');
  const [customPortModalOpen, setCustomPortModalOpen] = useState(false);

  // Active Sessions
  const [sessions, setSessions] = useState([
    {
      id: 'tun-01',
      device_name: 'Solar Site 01 Gateway',
      serial_number: 'NSV-2S-2026-00412',
      protocol: 'HTTP_LUCI',
      target: '127.0.0.1:80 (Router LuCI)',
      operator: 'admin@niseva.com',
      bytes: '14.2 MB',
      remaining: '18m 42s',
      status: 'CONNECTED',
    },
    {
      id: 'tun-02',
      device_name: 'Solar Site 02 Gateway',
      serial_number: 'NSV-2S-2026-00413',
      protocol: 'TERMINAL_SSH',
      target: '127.0.0.1:22 (Router Shell)',
      operator: 'alex@acmesolar.com',
      bytes: '3.8 MB',
      remaining: '24m 10s',
      status: 'CONNECTED',
    },
    {
      id: 'tun-03',
      device_name: 'Solar Site 01 Gateway',
      serial_number: 'NSV-2S-2026-00412',
      protocol: 'LAN_FORWARD',
      target: '192.168.1.50:502 (Solar Inverter #1)',
      operator: 'field.tech@acmesolar.com',
      bytes: '82.4 KB',
      remaining: '41m 00s',
      status: 'CONNECTED',
    },
  ]);

  const handleLaunchTunnel = (values: any) => {
    setActiveDeviceName(values.device);
    setActiveTunnelToken(`tun_${Date.now().toString().slice(-6)}`);

    if (values.protocol === 'HTTP_LUCI') {
      setLuciOpen(true);
    } else if (values.protocol === 'TERMINAL_SSH') {
      setTerminalOpen(true);
    } else if (values.protocol === 'SFTP') {
      setFileOpen(true);
    } else if (values.protocol === 'LAN_FORWARD') {
      setCustomPortModalOpen(true);
    }
    message.success('Establishing reverse WebSocket tunnel over CGNAT...');
  };

  const handleTerminate = (id: string) => {
    setSessions(sessions.filter((s) => s.id !== id));
    message.info('Remote tunnel terminated by operator');
  };

  const columns = [
    {
      title: 'Target Router',
      key: 'device',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827', fontSize: 14 }}>{record.device_name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.serial_number}</div>
        </div>
      ),
    },
    {
      title: 'Protocol & Target',
      key: 'protocol',
      render: (_: any, record: any) => (
        <div>
          <Space size={6}>
            {record.protocol === 'HTTP_LUCI' && <Tag color="blue" icon={<GlobalOutlined />}>HTTP LuCI</Tag>}
            {record.protocol === 'TERMINAL_SSH' && <Tag color="green" icon={<CodeOutlined />}>Web Terminal</Tag>}
            {record.protocol === 'LAN_FORWARD' && <Tag color="purple" icon={<DesktopOutlined />}>LAN Forward</Tag>}
            {record.protocol === 'SFTP' && <Tag color="orange" icon={<FolderOutlined />}>SFTP Files</Tag>}
          </Space>
          <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{record.target}</div>
        </div>
      ),
    },
    {
      title: 'Operator',
      dataIndex: 'operator',
      key: 'operator',
      render: (op: string) => <span style={{ color: '#111827', fontSize: 13 }}>{op}</span>,
    },
    {
      title: 'Data Transferred',
      dataIndex: 'bytes',
      key: 'bytes',
      render: (val: string) => <Tag color="default">{val}</Tag>,
    },
    {
      title: 'TTL Remaining',
      dataIndex: 'remaining',
      key: 'remaining',
      render: (time: string) => <span style={{ color: '#10b981', fontWeight: 500 }}>{time}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: () => <Badge status="success" text="● Active" />,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<LinkOutlined />}
            onClick={() => {
              setActiveDeviceName(record.device_name);
              if (record.protocol === 'HTTP_LUCI') setLuciOpen(true);
              else if (record.protocol === 'TERMINAL_SSH') setTerminalOpen(true);
              else if (record.protocol === 'SFTP') setFileOpen(true);
              else message.info(`TCP Endpoint: rms.niseva.com:22184 ➔ ${record.target}`);
            }}
          >
            Open Viewer
          </Button>
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            onClick={() => handleTerminate(record.id)}
          >
            Close
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Top Title Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: '#111827', fontWeight: 600 }}>RMS Connect (Remote Access Hub)</h2>
          <span style={{ color: '#6b7280', fontSize: 13 }}>
            Zero-configuration reverse tunneling through CGNAT and private cellular firewalls
          </span>
        </div>
        <Tag color="green" icon={<SafetyCertificateOutlined />} style={{ padding: '4px 10px', fontSize: 12 }}>
          Reverse WebSocket Gateway: ACTIVE
        </Tag>
      </div>

      {/* KPI Overview Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Active Tunnels"
              value={sessions.length}
              suffix="Sessions"
              valueStyle={{ color: '#2e90fa', fontWeight: 600 }}
              prefix={<ThunderboltOutlined />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Encrypted bidirectional tunnels
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="WebUI (LuCI) Sessions"
              value={1}
              valueStyle={{ color: '#10b981', fontWeight: 600 }}
              prefix={<GlobalOutlined />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Port 80 reverse HTTP proxy
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Web Terminal (SSH)"
              value={1}
              valueStyle={{ color: '#8b5cf6', fontWeight: 600 }}
              prefix={<CodeOutlined />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Port 22 interactive xterm.js pipe
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="LAN Device Tunnels"
              value={1}
              valueStyle={{ color: '#f59e0b', fontWeight: 600 }}
              prefix={<DesktopOutlined />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Inverter / PLC port forwarding
            </div>
          </Card>
        </Col>
      </Row>

      {/* Quick Connect Launchpad */}
      <Card
        title={<span><ThunderboltOutlined style={{ color: '#2e90fa', marginRight: 8 }} /> Quick Connect Launchpad</span>}
        bordered
        style={{ marginBottom: 16, borderColor: '#e5e7eb' }}
        bodyStyle={{ padding: 16 }}
      >
        <Form
          layout="inline"
          onFinish={handleLaunchTunnel}
          initialValues={{ device: 'Solar Site 01 Gateway', protocol: 'HTTP_LUCI' }}
        >
          <Form.Item label="Select Router" name="device" style={{ minWidth: 260 }}>
            <Select
              options={[
                { value: 'Solar Site 01 Gateway', label: '🟢 Solar Site 01 Gateway (NSV-2S-2026-00412)' },
                { value: 'Solar Site 02 Gateway', label: '🟢 Solar Site 02 Gateway (NSV-2S-2026-00413)' },
                { value: 'Substation Inverter #3', label: '○ Substation Inverter #3 (Offline)', disabled: true },
              ]}
            />
          </Form.Item>

          <Form.Item label="Service Protocol" name="protocol">
            <Radio.Group>
              <Radio.Button value="HTTP_LUCI">WebUI (LuCI Port 80)</Radio.Button>
              <Radio.Button value="TERMINAL_SSH">Web Terminal (SSH 22)</Radio.Button>
              <Radio.Button value="SFTP">SFTP Explorer</Radio.Button>
              <Radio.Button value="LAN_FORWARD">LAN Device Behind Router</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
              Establish Secure Tunnel
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* Active Sessions Table */}
      <Card
        title={<span>Active Remote Sessions ({sessions.length})</span>}
        bordered
        style={{ borderColor: '#e5e7eb' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table columns={columns} dataSource={sessions} rowKey="id" pagination={false} />
      </Card>

      {/* Embedded Viewers & Modals */}
      <LuciModal
        open={luciOpen}
        token={activeTunnelToken}
        deviceName={activeDeviceName}
        onClose={() => setLuciOpen(false)}
      />
      <TerminalModal
        open={terminalOpen}
        token={activeTunnelToken}
        deviceName={activeDeviceName}
        onClose={() => setTerminalOpen(false)}
      />
      <FileManagerModal
        open={fileOpen}
        deviceName={activeDeviceName}
        onClose={() => setFileOpen(false)}
      />

      {/* LAN Device Port Forwarding Modal */}
      <Modal
        title="Connect to LAN Device Behind Router"
        open={customPortModalOpen}
        onCancel={() => setCustomPortModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setCustomPortModalOpen(false)}>
            Close
          </Button>,
        ]}
      >
        <p style={{ color: '#4b5563', fontSize: 13 }}>
          A secure reverse tunnel has been established to the internal device connected on the router's LAN interface:
        </p>
        <div style={{ background: '#f8fafc', padding: 14, borderRadius: 6, border: '1px solid #e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>
          <div><strong>Target LAN Device:</strong> 192.168.1.50:502 (Solar Inverter #1)</div>
          <div style={{ marginTop: 6 }}><strong>Public Proxy Host:</strong> rms.niseva.com</div>
          <div style={{ marginTop: 6 }}><strong>Dynamic Assigned Port:</strong> <Tag color="blue">22184</Tag></div>
          <div style={{ marginTop: 6 }}><strong>Connection URL:</strong> modbus://rms.niseva.com:22184</div>
        </div>
      </Modal>
    </div>
  );
};
