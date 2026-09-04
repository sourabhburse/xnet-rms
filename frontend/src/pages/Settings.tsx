import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Tabs,
  Modal,
  Form,
  Input,
  Select,
  Progress,
  Row,
  Col,
  Statistic,
  Radio,
  message,
} from 'antd';
import {
  KeyOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  FileTextOutlined,
  CopyOutlined,
  PlusOutlined,
  CheckCircleFilled,
  ShopOutlined,
  SendOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';

export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState('tenants');
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [welcomeKitModalOpen, setWelcomeKitModalOpen] = useState(false);
  const [latestKit, setLatestKit] = useState<any>(null);

  // Mock Tenants / Client Organizations
  const [tenants, setTenants] = useState([
    {
      id: 'org-01',
      name: 'Acme Solar Corp',
      slug: 'acme-solar',
      admin_email: 'admin@acmesolar.com',
      device_count: 42,
      max_devices: 500,
      license_tier: 'Enterprise On-Premise',
      created_at: '2026-08-01',
      enrollment_token: 'NSV-ENROLL-SOLAR-2026-9B41',
    },
    {
      id: 'org-02',
      name: 'SunPower Energy Ltd',
      slug: 'sunpower-energy',
      admin_email: 'admin@sunpower.com',
      device_count: 12,
      max_devices: 100,
      license_tier: 'Standard Cloud SaaS',
      created_at: '2026-08-20',
      enrollment_token: 'NSV-ENROLL-SUNPOW-882A',
    },
  ]);

  // Mock Tokens
  const [tokens, setTokens] = useState([
    {
      id: 'token-01',
      name: 'Factory Solar Site Q3 Batch',
      token: 'NSV-ENROLL-SOLAR-2026-9B41',
      max_uses: 100,
      used_count: 42,
      expires_at: '2026-12-01',
      status: 'ACTIVE',
    },
    {
      id: 'token-02',
      name: 'Substation Inverter Pilot',
      token: 'NSV-ENROLL-PILOT-882A',
      max_uses: 10,
      used_count: 5,
      expires_at: '2026-10-01',
      status: 'ACTIVE',
    },
  ]);

  // Mock Team Members
  const [users, setUsers] = useState([
    {
      id: 'usr-01',
      email: 'admin@niseva.com',
      first_name: 'Alex',
      last_name: 'Chen',
      role: 'SUPER_ADMIN',
      created_at: '2026-08-01',
    },
    {
      id: 'usr-02',
      email: 'rajesh@acmesolar.com',
      first_name: 'Rajesh',
      last_name: 'Kumar',
      role: 'ORG_ADMIN',
      created_at: '2026-08-15',
    },
    {
      id: 'usr-03',
      email: 'pooja@acmesolar.com',
      first_name: 'Pooja',
      last_name: 'Patel',
      role: 'OPERATOR',
      created_at: '2026-08-20',
    },
  ]);

  // Mock Audit Logs
  const auditLogs = [
    {
      id: 'audit-01',
      user: 'admin@niseva.com',
      action: 'ROUTER_REBOOT',
      resource: 'NSV-2S-2026-00412',
      details: 'Dispatched remote reboot over MQTT',
      ip: '182.72.54.12',
      time: '15 mins ago',
    },
    {
      id: 'audit-02',
      user: 'rajesh@acmesolar.com',
      action: 'TUNNEL_OPEN_LUCI',
      resource: 'NSV-2S-2026-00412',
      details: 'Requested remote LuCI WebUI reverse proxy session',
      ip: '182.72.54.12',
      time: '45 mins ago',
    },
    {
      id: 'audit-03',
      user: 'admin@niseva.com',
      action: 'FOTA_ROLLOUT',
      resource: 'rollout-01',
      details: 'Started Canary rollout of firmware v1.2 LTS to 42 routers',
      ip: '182.72.54.12',
      time: '2 hours ago',
    },
  ];

  const productModels = [
    {
      model: 'Niseva 2S',
      category: 'Compact Industrial 4G Router',
      arch: 'mips_24kc',
      soc: 'MediaTek MT7628 / QCA9531',
      cellular: '4G LTE Cat 4 (Single SIM)',
      ethernet: '2x 10/100 Mbps (1 WAN, 1 LAN)',
      wifi: '2.4GHz 802.11b/g/n',
      serial: 'None',
      gps: false,
      target_use: 'Solar Monitoring, ATM Kiosks, Smart Metering',
      certified_fw: 'v1.0.0-lts',
    },
    {
      model: 'Niseva 2M',
      category: 'Dual-SIM & Modbus Industrial Gateway',
      arch: 'mips_24kc',
      soc: 'MediaTek MT7628AN',
      cellular: '4G LTE Cat 4 (Dual SIM Auto-Failover)',
      ethernet: '2x 10/100 Mbps (1 WAN, 1 LAN)',
      wifi: '2.4GHz 802.11b/g/n',
      serial: '1x RS485 / RS232 (Modbus RTU)',
      gps: false,
      target_use: 'Power Substation SCADA, PLC Inverters',
      certified_fw: 'v1.1.2-lts',
    },
    {
      model: 'Niseva 4G-Pro',
      category: 'Multi-Port Gigabit Fleet & Branch Router',
      arch: 'mips_1004kc',
      soc: 'MediaTek MT7621A Dual-Core 880MHz',
      cellular: '4G LTE Cat 6 / 12 (Dual SIM)',
      ethernet: '4x Gigabit 10/100/1000 Mbps',
      wifi: 'Dual-Band AC1200 (2.4G + 5GHz)',
      serial: '1x RS232 Console',
      gps: true,
      target_use: 'Transit Buses & Police Fleets, Branch Backup',
      certified_fw: 'v1.2.0-lts',
    },
    {
      model: 'Niseva 5G-Ultra',
      category: 'Next-Gen High-Throughput 5G Enterprise Gateway',
      arch: 'aarch64',
      soc: 'Quad-Core ARM Cortex-A53 1.3GHz',
      cellular: '5G Sub-6GHz SA/NSA (Dual SIM + eSIM)',
      ethernet: '5x Gigabit RJ45 + 1x SFP Optical Port',
      wifi: 'Wi-Fi 6 AX1800 (802.11ax)',
      serial: '1x RS485 Isolated + 2x DI/DO',
      gps: true,
      target_use: 'CCTV Video Surveillance, Port Automation, Edge AI',
      certified_fw: 'v2.0.0-rc1',
    },
  ];

  const handleCreateTenant = (values: any) => {
    const password = values.password || 'Welcome@2026!';
    const token = `NSV-ENROLL-${values.name.substring(0, 6).toUpperCase().replace(/\s+/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newTenant = {
      id: `org-${Date.now().toString().slice(-4)}`,
      name: values.name,
      slug: values.name.toLowerCase().replace(/\s+/g, '-'),
      admin_email: values.admin_email,
      device_count: 0,
      max_devices: values.max_devices ? parseInt(values.max_devices, 10) : 100,
      license_tier: values.license_tier || 'Standard Cloud SaaS',
      created_at: 'Today',
      enrollment_token: token,
    };

    setTenants([newTenant, ...tenants]);
    setTenantModalOpen(false);

    // Prepare Welcome Kit
    const kit = {
      company: values.name,
      portal_url: 'http://82.180.146.203:8080',
      admin_email: values.admin_email,
      password: password,
      max_devices: newTenant.max_devices,
      token: token,
      provision_cmd: `uci set niseva.general.enrollment_token='${token}' && uci commit && /etc/init.d/niseva-agent restart`,
    };
    setLatestKit(kit);
    setWelcomeKitModalOpen(true);
    message.success(`Tenant Organization "${values.name}" created!`);
  };

  const copyWelcomeKit = () => {
    if (!latestKit) return;
    const text = `=====================================================
🎉 WELCOME TO XNET CLOUD RMS FLEET PORTAL
=====================================================
Company: ${latestKit.company}
Portal URL: ${latestKit.portal_url}
Admin Login: ${latestKit.admin_email}
Temporary Password: ${latestKit.password}
Licensed Router Capacity: ${latestKit.max_devices} Routers

ROUTER ZERO-TOUCH PROVISIONING COMMAND:
Run this on your Niseva 2S OpenWrt routers to automatically bind them to your portal:
${latestKit.provision_cmd}
=====================================================`;

    navigator.clipboard.writeText(text);
    message.success('Client Welcome Kit copied to clipboard!');
  };

  const tenantColumns = [
    {
      title: 'Company / Organization',
      key: 'name',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827', fontSize: 14 }}>{record.name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Admin: <a href={`mailto:${record.admin_email}`} style={{ color: '#2e90fa' }}>{record.admin_email}</a>
          </div>
        </div>
      ),
    },
    {
      title: 'Connected Routers',
      key: 'routers',
      render: (_: any, record: any) => (
        <div>
          <Progress
            percent={Math.round((record.device_count / record.max_devices) * 100)}
            size="small"
            style={{ width: 140 }}
          />
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            {record.device_count} of {record.max_devices} Routers Active
          </div>
        </div>
      ),
    },
    {
      title: 'License Tier',
      dataIndex: 'license_tier',
      key: 'license_tier',
      render: (tier: string) => (
        <Tag color={tier.includes('On-Premise') ? 'purple' : 'blue'}>{tier}</Tag>
      ),
    },
    {
      title: 'Onboarded Date',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => <span style={{ color: '#6b7280' }}>{val}</span>,
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: any, record: any) => (
        <Button
          size="small"
          type="primary"
          ghost
          icon={<SendOutlined />}
          onClick={() => {
            setLatestKit({
              company: record.name,
              portal_url: 'http://82.180.146.203:8080',
              admin_email: record.admin_email,
              password: 'Welcome@2026!',
              max_devices: record.max_devices,
              token: record.enrollment_token,
              provision_cmd: `uci set niseva.general.enrollment_token='${record.enrollment_token}' && uci commit && /etc/init.d/niseva-agent restart`,
            });
            setWelcomeKitModalOpen(true);
          }}
        >
          View Client Kit
        </Button>
      ),
    },
  ];

  const tokenColumns = [
    {
      title: 'Token Name & Key',
      key: 'name',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827', fontSize: 14 }}>{record.name}</strong>
          <div>
            <code style={{ fontSize: 12, color: '#2e90fa', background: '#eff8ff', padding: '2px 8px', borderRadius: 4 }}>
              {record.token}
            </code>
          </div>
        </div>
      ),
    },
    {
      title: 'Usage / Quota',
      key: 'usage',
      render: (_: any, record: any) => (
        <div>
          <Progress
            percent={Math.round((record.used_count / record.max_uses) * 100)}
            size="small"
            style={{ width: 140 }}
          />
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            {record.used_count} of {record.max_uses} Routers Claimed
          </div>
        </div>
      ),
    },
    {
      title: 'Expires At',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (val: string) => <span style={{ color: '#6b7280' }}>{val}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: () => <Tag color="success">● ACTIVE</Tag>,
    },
    {
      title: 'Provisioning Command',
      key: 'action',
      render: (_: any, record: any) => (
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={() => {
            const cmd = `uci set niseva.general.enrollment_token='${record.token}' && uci commit && /etc/init.d/niseva-agent restart`;
            navigator.clipboard.writeText(cmd);
            message.success('OpenWrt 1-liner copied to clipboard!');
          }}
        >
          Copy OpenWrt 1-Liner
        </Button>
      ),
    },
  ];

  const userColumns = [
    {
      title: 'Member Name',
      key: 'name',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827' }}>{record.first_name} {record.last_name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.email}</div>
        </div>
      ),
    },
    {
      title: 'RBAC Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        if (role === 'SUPER_ADMIN') return <Tag color="red">SUPER ADMIN</Tag>;
        if (role === 'ORG_ADMIN') return <Tag color="blue">ORG ADMIN</Tag>;
        if (role === 'OPERATOR') return <Tag color="green">OPERATOR</Tag>;
        return <Tag color="default">{role}</Tag>;
      },
    },
    {
      title: 'Added Date',
      dataIndex: 'created_at',
      key: 'created_at',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: '#111827', fontWeight: 600 }}>Tenant, Security & Tokens</h2>
          <span style={{ color: '#6b7280', fontSize: 13 }}>
            Multi-tenant customer onboarding, zero-touch tokens, RBAC roles, and on-premise license management
          </span>
        </div>
        <Space>
          {activeTab === 'tenants' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setTenantModalOpen(true)}>
              + Onboard New Tenant
            </Button>
          )}
          {activeTab === 'tokens' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setTokenModalOpen(true)}>
              + Generate Batch Token
            </Button>
          )}
          {activeTab === 'users' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setUserModalOpen(true)}>
              + Invite Team Member
            </Button>
          )}
        </Space>
      </div>

      <Card bordered bodyStyle={{ padding: '8px 16px' }} style={{ borderColor: '#e5e7eb' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'tenants',
              label: (
                <span>
                  <ShopOutlined /> Client Organizations ({tenants.length})
                </span>
              ),
              children: (
                <div>
                  <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, marginBottom: 16, border: '1px solid #e2e8f0' }}>
                    <strong style={{ color: '#1e293b' }}>Multi-Tenant Client Isolation:</strong>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                      Each tenant organization has completely isolated database rows, independent router registries, custom configuration templates, and separate operator teams.
                    </div>
                  </div>
                  <Table columns={tenantColumns} dataSource={tenants} rowKey="id" pagination={false} />
                </div>
              ),
            },
            {
              key: 'products',
              label: (
                <span>
                  <ApartmentOutlined /> Hardware Product Lines ({productModels.length})
                </span>
              ),
              children: (
                <Table
                  dataSource={productModels}
                  rowKey="model"
                  pagination={false}
                  columns={[
                    {
                      title: 'Product Model',
                      key: 'model',
                      render: (_: any, r: any) => (
                        <div>
                          <strong style={{ color: '#111827', fontSize: 14 }}>{r.model}</strong>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{r.category}</div>
                        </div>
                      ),
                    },
                    {
                      title: 'Architecture & SoC',
                      key: 'soc',
                      render: (_: any, r: any) => (
                        <div>
                          <Tag color="cyan">{r.arch}</Tag>
                          <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{r.soc}</div>
                        </div>
                      ),
                    },
                    {
                      title: 'Cellular & Interfaces',
                      key: 'cellular',
                      render: (_: any, r: any) => (
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 13, color: '#111827' }}>{r.cellular}</div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{r.ethernet} • {r.wifi}</div>
                        </div>
                      ),
                    },
                    {
                      title: 'Hardware Features',
                      key: 'features',
                      render: (_: any, r: any) => (
                        <Space size={4} wrap>
                          {r.serial !== 'None' && <Tag color="purple">{r.serial}</Tag>}
                          {r.gps && <Tag color="gold">GPS / GNSS</Tag>}
                          {r.model.includes('5G') && <Tag color="volcano">5G Sub-6</Tag>}
                          {r.model.includes('4G-Pro') && <Tag color="blue">Gigabit</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: 'Target Application',
                      dataIndex: 'target_use',
                      key: 'target_use',
                      render: (t: string) => <span style={{ fontSize: 12, color: '#4b5563' }}>{t}</span>,
                    },
                    {
                      title: 'Certified Firmware',
                      dataIndex: 'certified_fw',
                      key: 'certified_fw',
                      render: (fw: string) => <Tag color="green">{fw}</Tag>,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'tokens',
              label: (
                <span>
                  <KeyOutlined /> Zero-Touch Enrollment Tokens ({tokens.length})
                </span>
              ),
              children: (
                <Table columns={tokenColumns} dataSource={tokens} rowKey="id" pagination={false} />
              ),
            },
            {
              key: 'users',
              label: (
                <span>
                  <TeamOutlined /> Team Members & RBAC ({users.length})
                </span>
              ),
              children: (
                <Table columns={userColumns} dataSource={users} rowKey="id" pagination={false} />
              ),
            },
            {
              key: 'license',
              label: (
                <span>
                  <SafetyCertificateOutlined /> On-Premise License & Capacity
                </span>
              ),
              children: (
                <div>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
                        <Statistic
                          title="Licensed Node Capacity"
                          value={42}
                          suffix="/ 500 Nodes"
                          valueStyle={{ color: '#111827', fontWeight: 600 }}
                        />
                        <Progress percent={8.4} size="small" status="active" style={{ marginTop: 8 }} />
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                          458 node slots available for expansion
                        </div>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
                        <Statistic
                          title="License Tier"
                          value="Enterprise On-Premise"
                          valueStyle={{ color: '#2e90fa', fontSize: 18, fontWeight: 600 }}
                        />
                        <div style={{ marginTop: 12 }}>
                          <Tag color="success" icon={<CheckCircleFilled />}>
                            Cryptographic Signature: VALID
                          </Tag>
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                          Algorithm: ECDSA-P256-SHA256 • Hardware Locked
                        </div>
                      </Card>
                    </Col>
                    <Col xs={24} md={8}>
                      <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
                        <Statistic
                          title="License Expiry"
                          value="484 Days Remaining"
                          valueStyle={{ color: '#10b981', fontSize: 18, fontWeight: 600 }}
                        />
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 16 }}>
                          Valid through: <strong>2027-12-31</strong>
                        </div>
                      </Card>
                    </Col>
                  </Row>
                </div>
              ),
            },
            {
              key: 'audit',
              label: (
                <span>
                  <FileTextOutlined /> Compliance Audit Trail
                </span>
              ),
              children: (
                <Table
                  dataSource={auditLogs}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  columns={[
                    { title: 'Time', dataIndex: 'time', key: 'time' },
                    { title: 'Operator', dataIndex: 'user', key: 'user' },
                    { title: 'Action', dataIndex: 'action', key: 'action', render: (a: string) => <Tag color="blue">{a}</Tag> },
                    { title: 'Resource', dataIndex: 'resource', key: 'resource', render: (r: string) => <code>{r}</code> },
                    { title: 'Details', dataIndex: 'details', key: 'details' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      {/* Onboard New Tenant Modal */}
      <Modal
        title="Onboard New Tenant Organization"
        open={tenantModalOpen}
        onCancel={() => setTenantModalOpen(false)}
        footer={null}
        width={520}
      >
        <Form layout="vertical" onFinish={handleCreateTenant} initialValues={{ max_devices: 100, license_tier: 'Standard Cloud SaaS' }}>
          <Form.Item label="Company / Tenant Name" name="name" rules={[{ required: true, message: 'Please enter company name' }]}>
            <Input placeholder="e.g. Adani Solar Farms Ltd" />
          </Form.Item>

          <Form.Item label="Client Administrator Email" name="admin_email" rules={[{ required: true, type: 'email', message: 'Valid email required' }]}>
            <Input placeholder="admin@adanisolar.com" />
          </Form.Item>

          <Form.Item label="Initial Password (Optional)" name="password">
            <Input.Password placeholder="Leave blank to auto-generate (Welcome@2026!)" />
          </Form.Item>

          <Form.Item label="Licensed Routers (Capacity Quota)" name="max_devices">
            <Input type="number" placeholder="100" />
          </Form.Item>

          <Form.Item label="Hosting & License Model" name="license_tier">
            <Radio.Group>
              <Radio.Button value="Standard Cloud SaaS">Multi-Tenant Cloud SaaS</Radio.Button>
              <Radio.Button value="Enterprise On-Premise">Client Server On-Premise</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <Button onClick={() => setTenantModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit">
              Create Tenant & Generate Credentials Kit
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Tenant Credentials & Welcome Kit Modal */}
      <Modal
        title={<span><ShopOutlined style={{ color: '#2e90fa', marginRight: 8 }} /> Tenant Credentials & Onboarding Kit</span>}
        open={welcomeKitModalOpen}
        onCancel={() => setWelcomeKitModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setWelcomeKitModalOpen(false)}>
            Close
          </Button>,
          <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={copyWelcomeKit}>
            Copy Welcome Kit for Client
          </Button>,
        ]}
        width={620}
      >
        {latestKit && (
          <div>
            <p style={{ color: '#4b5563', fontSize: 13, marginBottom: 16 }}>
              The client organization has been registered with its own isolated database scope. Send the credentials below to the client administrator:
            </p>

            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>
              <div style={{ fontWeight: 'bold', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: 6, marginBottom: 10 }}>
                CLIENT ACCESS DETAILS
              </div>
              <div style={{ margin: '4px 0' }}><strong>Company:</strong> {latestKit.company}</div>
              <div style={{ margin: '4px 0' }}><strong>Web Portal URL:</strong> <a href={latestKit.portal_url} target="_blank" rel="noreferrer">{latestKit.portal_url}</a></div>
              <div style={{ margin: '4px 0' }}><strong>Admin Email:</strong> <span style={{ color: '#2e90fa' }}>{latestKit.admin_email}</span></div>
              <div style={{ margin: '4px 0' }}><strong>Initial Password:</strong> <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: 4 }}>{latestKit.password}</code></div>
              <div style={{ margin: '4px 0' }}><strong>Capacity Limit:</strong> {latestKit.max_devices} Routers</div>

              <div style={{ fontWeight: 'bold', color: '#1e293b', borderBottom: '1px solid #cbd5e1', paddingBottom: 6, marginTop: 16, marginBottom: 8 }}>
                ZERO-TOUCH ROUTER PROVISIONING COMMAND
              </div>
              <div style={{ color: '#475569', fontSize: 11, marginBottom: 6 }}>
                Field engineers can paste this single command into any Niseva 2S router terminal:
              </div>
              <div style={{ background: '#1e293b', color: '#38bdf8', padding: 10, borderRadius: 6, wordBreak: 'break-all' }}>
                {latestKit.provision_cmd}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
