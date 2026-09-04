import React, { useState } from 'react';
import {
  Card,
  Descriptions,
  Tag,
  Tabs,
  Button,
  Space,
  Form,
  Input,
  Progress,
  Row,
  Col,
  Statistic,
  Select,
  Alert,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  GlobalOutlined,
  CodeOutlined,
  FolderOutlined,
  ReloadOutlined,
  SignalFilled,
  ThunderboltOutlined,
  StopOutlined,
  CopyOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { LuciModal } from '../components/LuciModal';
import { TerminalModal } from '../components/TerminalModal';
import { FileManagerModal } from '../components/FileManagerModal';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Props {
  deviceId: string;
  onBack: () => void;
}

export const DeviceDetail: React.FC<Props> = ({ deviceId, onBack }) => {
  const [luciOpen, setLuciOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);

  // On-demand SFTP state
  const [sftpActive, setSftpActive] = useState(false);
  const [sftpTtl, setSftpTtl] = useState(30);
  const [sftpPort, setSftpPort] = useState(38194);
  const [sftpPassword, setSftpPassword] = useState('sftp_tmp_8f921d9e');

  const device = {
    id: deviceId,
    name: 'Solar Site 01 Gateway',
    serial_number: 'NSV-2S-2026-00412',
    mac_address: '00:1A:2B:3C:4D:5E',
    model: 'Niseva 2S (MIPS 24Kc)',
    imei: '868896069606673',
    firmware_version: 'v1.0.0-lts',
    status: 'ONLINE',
    last_ip: '10.124.50.21',
  };

  const signalHistory = [
    { time: '00:00', rssi: 82, rsrp: -86 },
    { time: '04:00', rssi: 85, rsrp: -84 },
    { time: '08:00', rssi: 80, rsrp: -89 },
    { time: '12:00', rssi: 87, rsrp: -82 },
    { time: '16:00', rssi: 85, rsrp: -85 },
    { time: '20:00', rssi: 86, rsrp: -83 },
  ];

  const handleGenerateSftp = () => {
    const port = Math.floor(30000 + Math.random() * 20000);
    const pwd = `sftp_${Math.random().toString(36).slice(-8)}`;
    setSftpPort(port);
    setSftpPassword(pwd);
    setSftpActive(true);
    message.success(`Ephemeral SFTP session created! Dynamic port :${port} will auto-close in ${sftpTtl} minutes.`);
  };

  const handleTerminateSftp = () => {
    setSftpActive(false);
    message.info('SFTP session terminated immediately. Port closed and credentials expired.');
  };

  return (
    <div>
      {/* Top Header with Quick Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space size={12}>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            Back to Fleet
          </Button>
          <h2 style={{ margin: 0, color: '#111827', fontWeight: 600 }}>{device.name}</h2>
          <Tag color="success">● ONLINE</Tag>
          <Tag color="blue">{device.model}</Tag>
        </Space>

        <Space>
          <Button type="primary" icon={<GlobalOutlined />} onClick={() => setLuciOpen(true)}>
            WebUI (LuCI)
          </Button>
          <Button icon={<CodeOutlined />} onClick={() => setTermOpen(true)}>
            Web Terminal
          </Button>
          <Button icon={<FolderOutlined />} onClick={() => setFileOpen(true)}>
            SFTP Files
          </Button>
          <Button danger icon={<ReloadOutlined />}>
            Reboot
          </Button>
        </Space>
      </div>

      {/* Main KPI Row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Cellular RF Signal"
              value={82}
              suffix="/ 100"
              valueStyle={{ color: '#10b981', fontWeight: 600 }}
              prefix={<SignalFilled />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Airtel 4G LTE • RSRP: -85 dBm • SINR: 18 dB
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Memory Utilization"
              value={42}
              suffix="%"
              valueStyle={{ color: '#111827', fontWeight: 600 }}
            />
            <Progress percent={42} size="small" status="active" style={{ marginTop: 4 }} />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>53 MB used of 128 MB RAM</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Storage Flash (/overlay)"
              value={3.2}
              suffix="MB Free"
              valueStyle={{ color: '#111827', fontWeight: 600 }}
            />
            <Progress percent={68} size="small" style={{ marginTop: 4 }} />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>7.8 MB of 16 MB used</div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="System Uptime"
              value="10d 4h 12m"
              valueStyle={{ color: '#2e90fa', fontWeight: 600 }}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 12 }}>
              Load Average: 0.12, 0.08, 0.05
            </div>
          </Card>
        </Col>
      </Row>

      {/* Tabs Detail View */}
      <Card bordered bodyStyle={{ padding: '8px 16px' }} style={{ borderColor: '#e5e7eb' }}>
        <Tabs
          defaultActiveKey="1"
          items={[
            {
              key: '1',
              label: 'Overview & RF History',
              children: (
                <div>
                  <Descriptions bordered size="small" column={3} style={{ marginBottom: 20 }}>
                    <Descriptions.Item label="Serial Number">
                      <code>{device.serial_number}</code>
                    </Descriptions.Item>
                    <Descriptions.Item label="MAC Address">
                      <code>{device.mac_address}</code>
                    </Descriptions.Item>
                    <Descriptions.Item label="Hardware Model">{device.model}</Descriptions.Item>
                    <Descriptions.Item label="Modem IMEI">{device.imei}</Descriptions.Item>
                    <Descriptions.Item label="Firmware Version">
                      <Tag color="cyan">{device.firmware_version}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="WAN IP Address">{device.last_ip}</Descriptions.Item>
                  </Descriptions>

                  <h4 style={{ color: '#111827', margin: '16px 0 8px 0' }}>24-Hour Cellular RSSI & RSRP Trend</h4>
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={signalHistory}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="time" stroke="#9ca3af" fontSize={12} />
                        <YAxis stroke="#9ca3af" fontSize={12} domain={[60, 100]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="rssi" name="RSSI" stroke="#10b981" strokeWidth={2} dot />
                        <Line type="monotone" dataKey="rsrp" name="RSRP" stroke="#2e90fa" strokeWidth={2} dot />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ),
            },
            {
              key: '2',
              label: 'IPsec strongSwan VPN',
              children: (
                <div>
                  <Descriptions bordered size="small" column={2}>
                    <Descriptions.Item label="Tunnel Status">
                      <Tag color="success">ESTABLISHED (IKEv2)</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Remote Gateway">198.51.100.1</Descriptions.Item>
                    <Descriptions.Item label="Cipher">AES-GCM-256 / SHA256</Descriptions.Item>
                    <Descriptions.Item label="Local Subnet">192.168.1.0/24</Descriptions.Item>
                    <Descriptions.Item label="Remote Subnet">10.0.0.0/16</Descriptions.Item>
                  </Descriptions>
                </div>
              ),
            },
            {
              key: '3',
              label: 'On-Demand Desktop SFTP (FileZilla / WinSCP)',
              children: (
                <div style={{ padding: '8px 0' }}>
                  {!sftpActive ? (
                    <div>
                      <Alert
                        message="Desktop SFTP Port Closed (Enterprise On-Demand Security)"
                        description="In accordance with industrial cybersecurity standards and cellular bandwidth conservation, external desktop SFTP listeners are closed by default. You can open an ephemeral, time-limited SFTP tunnel when you need to transfer files using FileZilla, WinSCP, or Cyberduck."
                        type="info"
                        showIcon
                        icon={<SafetyCertificateOutlined />}
                        style={{ marginBottom: 16 }}
                      />

                      <Card size="small" bordered style={{ borderColor: '#e5e7eb', maxWidth: 640 }}>
                        <Form layout="vertical">
                          <Form.Item label="Session Auto-Termination Timeout (TTL)">
                            <Select
                              value={sftpTtl}
                              onChange={setSftpTtl}
                              options={[
                                { value: 15, label: '15 Minutes' },
                                { value: 30, label: '30 Minutes (Recommended)' },
                                { value: 60, label: '60 Minutes (Large Logs Download)' },
                              ]}
                            />
                          </Form.Item>

                          <Button
                            type="primary"
                            icon={<ThunderboltOutlined />}
                            onClick={handleGenerateSftp}
                            style={{ height: 38, fontWeight: 600 }}
                          >
                            ⚡ Generate On-Demand SFTP Session
                          </Button>
                        </Form>
                      </Card>
                    </div>
                  ) : (
                    <div>
                      <Alert
                        message={`⚡ Ephemeral SFTP Session Active (${sftpTtl}-Minute TTL)`}
                        description={`The router has opened an encrypted reverse tunnel through the cloud gateway. This session will automatically self-destruct in ${sftpTtl} minutes.`}
                        type="success"
                        showIcon
                        action={
                          <Button danger size="small" icon={<StopOutlined />} onClick={handleTerminateSftp}>
                            Terminate Session Now
                          </Button>
                        }
                        style={{ marginBottom: 16 }}
                      />

                      <Descriptions title="Temporary Desktop SFTP Credentials" bordered size="small" column={2}>
                        <Descriptions.Item label="SFTP Host">
                          <code>82.180.146.203</code> (or <code>rms.niseva.com</code>)
                        </Descriptions.Item>
                        <Descriptions.Item label="Dynamic Ephemeral Port">
                          <Tag color="blue" style={{ fontSize: 13, fontWeight: 600 }}>:{sftpPort}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="Username">
                          <code>root</code>
                        </Descriptions.Item>
                        <Descriptions.Item label="One-Time Password">
                          <Input.Password value={sftpPassword} style={{ width: 180 }} readOnly />
                        </Descriptions.Item>
                        <Descriptions.Item label="FileZilla / WinSCP 1-Liner" span={2}>
                          <Space>
                            <code style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: 4 }}>
                              sftp -P {sftpPort} root@82.180.146.203
                            </code>
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => {
                                navigator.clipboard.writeText(`sftp -P ${sftpPort} root@82.180.146.203`);
                                message.success('Connection string copied!');
                              }}
                            >
                              Copy
                            </Button>
                          </Space>
                        </Descriptions.Item>
                      </Descriptions>
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: '4',
              label: 'UCI Configuration',
              children: (
                <div style={{ maxWidth: 600 }}>
                  <Form layout="vertical">
                    <Form.Item label="Wi-Fi SSID (radio0)">
                      <Input defaultValue="SolarOffice-WiFi" />
                    </Form.Item>
                    <Form.Item label="Cellular APN (wwan0)">
                      <Input defaultValue="airtelgprs.com" />
                    </Form.Item>
                    <Form.Item label="Failsafe Watchdog Rollback Timer">
                      <Input defaultValue="180 seconds" disabled />
                    </Form.Item>
                    <Button type="primary">Push Configuration with Safe Rollback</Button>
                  </Form>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Embedded Remote Modals */}
      <LuciModal
        open={luciOpen}
        token="mock_token"
        deviceName={device.name}
        onClose={() => setLuciOpen(false)}
      />
      <TerminalModal
        open={termOpen}
        token="mock_token"
        deviceName={device.name}
        onClose={() => setTermOpen(false)}
      />
      <FileManagerModal
        open={fileOpen}
        deviceName={device.name}
        onClose={() => setFileOpen(false)}
      />
    </div>
  );
};
