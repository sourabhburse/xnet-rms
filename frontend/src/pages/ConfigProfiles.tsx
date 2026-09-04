import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Radio,
  Alert,
  message,
} from 'antd';
import {
  PlusOutlined,
  SendOutlined,
  WifiOutlined,
  SignalFilled,
  SafetyCertificateOutlined,
  ForkOutlined,
  CodeOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';

export const ConfigProfiles: React.FC = () => {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [builderType, setBuilderType] = useState('CELLULAR');

  // Mock Profiles
  const [profiles, setProfiles] = useState([
    {
      id: 'prof-01',
      name: 'Standard Airtel 4G & Dual-SIM Fallback',
      subsystem: 'CELLULAR',
      description: 'Configures primary wwan0 APN to airtelgprs.com with auto-APN retry.',
      version: 2,
      commands_count: 3,
      created_at: '2026-08-25',
    },
    {
      id: 'prof-02',
      name: 'Solar Farm Office Wi-Fi (WPA3-SAE)',
      subsystem: 'WIFI',
      description: 'Secure 2.4GHz office Wi-Fi with WPA3-SAE mixed encryption.',
      version: 1,
      commands_count: 3,
      created_at: '2026-08-28',
    },
    {
      id: 'prof-03',
      name: 'Headquarters IPsec strongSwan Tunnel',
      subsystem: 'IPSEC',
      description: 'Site-to-site IPsec tunnel bridging 192.168.1.0/24 to HQ 10.0.0.0/16.',
      version: 3,
      commands_count: 4,
      created_at: '2026-08-30',
    },
    {
      id: 'prof-04',
      name: 'Modbus TCP Port Forward (Port 502)',
      subsystem: 'FIREWALL',
      description: 'Forwards WAN TCP 502 to internal solar inverter gateway at 192.168.1.50:502.',
      version: 1,
      commands_count: 8,
      created_at: '2026-09-01',
    },
  ]);

  const handleOpenPush = (profile: any) => {
    setSelectedProfile(profile);
    setPushModalOpen(true);
  };

  const handlePushSubmit = () => {
    message.success(`Configuration profile "${selectedProfile.name}" dispatched to 42 routers with 180s failsafe rollback!`);
    setPushModalOpen(false);
  };

  const handleCreateProfile = (values: any) => {
    const newProf = {
      id: `prof-${Date.now().toString().slice(-4)}`,
      name: values.name,
      subsystem: builderType,
      description: values.description || 'Custom configuration profile',
      version: 1,
      commands_count: 3,
      created_at: 'Today',
    };
    setProfiles([...profiles, newProf]);
    setCreateModalOpen(false);
    message.success('Configuration profile created!');
  };

  const columns = [
    {
      title: 'Profile Name',
      key: 'name',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827', fontSize: 14 }}>{record.name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.description}</div>
        </div>
      ),
    },
    {
      title: 'Subsystem',
      dataIndex: 'subsystem',
      key: 'subsystem',
      render: (sys: string) => {
        if (sys === 'CELLULAR') return <Tag icon={<SignalFilled />} color="blue">Cellular APN</Tag>;
        if (sys === 'WIFI') return <Tag icon={<WifiOutlined />} color="green">Wi-Fi Network</Tag>;
        if (sys === 'IPSEC') return <Tag icon={<SafetyCertificateOutlined />} color="purple">IPsec VPN</Tag>;
        if (sys === 'FIREWALL') return <Tag icon={<ForkOutlined />} color="orange">Port Forward</Tag>;
        return <Tag icon={<CodeOutlined />}>Custom UCI</Tag>;
      },
    },
    {
      title: 'UCI Rules',
      dataIndex: 'commands_count',
      key: 'commands_count',
      render: (count: number) => <Tag color="default">{count} UCI Commands</Tag>,
    },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      render: (ver: number) => <Tag color="cyan">v{ver}.0</Tag>,
    },
    {
      title: 'Created Date',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => <span style={{ color: '#6b7280' }}>{val}</span>,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Button
          type="primary"
          ghost
          size="small"
          icon={<SendOutlined />}
          onClick={() => handleOpenPush(record)}
        >
          Push to Fleet
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: '#111827', fontWeight: 600 }}>Configuration Profiles</h2>
          <span style={{ color: '#6b7280', fontSize: 13 }}>
            Reusable OpenWrt UCI templates with visual builders and automated 180-second failsafe rollback
          </span>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          + Create Profile
        </Button>
      </div>

      <Card bordered bodyStyle={{ padding: 0 }} style={{ borderColor: '#e5e7eb' }}>
        <Table columns={columns} dataSource={profiles} rowKey="id" pagination={false} />
      </Card>

      {/* Push Profile Modal */}
      <Modal
        title={`Deploy Profile: ${selectedProfile?.name}`}
        open={pushModalOpen}
        onCancel={() => setPushModalOpen(false)}
        onOk={handlePushSubmit}
        okText="Push with 180s Rollback Watchdog"
        width={540}
      >
        <Alert
          message="180-Second Failsafe Rollback Active"
          description="If any router loses connection to the Cloud RMS after applying these changes, the native C watchdog on the router will automatically restore the previous /etc/config backup within 3 minutes."
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          style={{ marginBottom: 16 }}
        />

        <Form layout="vertical">
          <Form.Item label="Target Routers">
            <Radio.Group defaultValue="ALL">
              <Radio value="ALL">All Online Routers (40 Online Gateways)</Radio>
              <Radio value="GROUP" style={{ marginTop: 8 }}>By Device Group (e.g. Solar Site 01)</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Profile Modal */}
      <Modal
        title="Create Configuration Profile"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        footer={null}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <Radio.Group
            value={builderType}
            onChange={(e) => setBuilderType(e.target.value)}
            buttonStyle="solid"
            style={{ width: '100%', display: 'flex' }}
          >
            <Radio.Button value="CELLULAR" style={{ flex: 1, textAlign: 'center' }}>Cellular</Radio.Button>
            <Radio.Button value="WIFI" style={{ flex: 1, textAlign: 'center' }}>Wi-Fi</Radio.Button>
            <Radio.Button value="IPSEC" style={{ flex: 1, textAlign: 'center' }}>IPsec</Radio.Button>
            <Radio.Button value="FIREWALL" style={{ flex: 1, textAlign: 'center' }}>Port Forward</Radio.Button>
            <Radio.Button value="RAW" style={{ flex: 1, textAlign: 'center' }}>Raw UCI</Radio.Button>
          </Radio.Group>
        </div>

        <Form layout="vertical" onFinish={handleCreateProfile}>
          <Form.Item label="Profile Name" name="name" rules={[{ required: true, message: 'Please enter profile name' }]}>
            <Input placeholder="e.g. Gujarat Inverter Wi-Fi Settings" />
          </Form.Item>

          <Form.Item label="Description" name="description">
            <Input placeholder="Brief note explaining the purpose of this profile" />
          </Form.Item>

          {/* Subsystem specific visual form fields */}
          {builderType === 'CELLULAR' && (
            <>
              <Form.Item label="Access Point Name (APN)" name="apn" initialValue="airtelgprs.com">
                <Input placeholder="e.g. airtelgprs.com or jionet" />
              </Form.Item>
              <Form.Item label="SIM PIN Code (Optional)" name="pin">
                <Input placeholder="Leave blank if disabled" />
              </Form.Item>
              <Form.Item label="Roaming Policy">
                <Select defaultValue="ALLOWED" options={[{ value: 'ALLOWED', label: 'Allow Domestic Roaming' }, { value: 'BLOCKED', label: 'Block Roaming' }]} />
              </Form.Item>
            </>
          )}

          {builderType === 'WIFI' && (
            <>
              <Form.Item label="Wi-Fi SSID (2.4GHz)" name="ssid" initialValue="SolarOffice-WiFi">
                <Input />
              </Form.Item>
              <Form.Item label="Encryption Mode">
                <Select defaultValue="sae-mixed" options={[{ value: 'sae-mixed', label: 'WPA3-SAE / WPA2-PSK Mixed' }, { value: 'psk2', label: 'WPA2-PSK Only' }]} />
              </Form.Item>
              <Form.Item label="Wi-Fi Password" name="key" initialValue="SolarSecure2026!">
                <Input.Password />
              </Form.Item>
            </>
          )}

          {builderType === 'IPSEC' && (
            <>
              <Form.Item label="Remote Gateway IP" name="gateway" initialValue="198.51.100.1">
                <Input />
              </Form.Item>
              <Form.Item label="Pre-Shared Key (PSK)" name="psk" initialValue="SuperSecretPsk2026">
                <Input.Password />
              </Form.Item>
              <Form.Item label="Remote Subnet CIDR" name="remote_subnet" initialValue="10.0.0.0/16">
                <Input />
              </Form.Item>
            </>
          )}

          {builderType === 'FIREWALL' && (
            <>
              <Form.Item label="WAN External Port" name="src_port" initialValue="502">
                <Input />
              </Form.Item>
              <Form.Item label="LAN Internal IP Address" name="dest_ip" initialValue="192.168.1.50">
                <Input />
              </Form.Item>
              <Form.Item label="LAN Internal Port" name="dest_port" initialValue="502">
                <Input />
              </Form.Item>
            </>
          )}

          {builderType === 'RAW' && (
            <Form.Item label="Raw UCI Commands (One per line)" name="raw_uci">
              <Input.TextArea
                rows={5}
                placeholder="set system.@system[0].zonename='Asia/Kolkata'&#10;set system.@system[0].timezone='IST-5:30'"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Form.Item>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <Button onClick={() => setCreateModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit">
              Save Profile Template
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};
