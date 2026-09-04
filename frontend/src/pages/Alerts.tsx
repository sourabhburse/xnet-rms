import React, { useState } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Tabs,
  Switch,
  Modal,
  Form,
  Input,
  Select,
  Row,
  Col,
  Statistic,
  Radio,
  message,
} from 'antd';
import {
  AlertOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';

export const Alerts: React.FC = () => {
  const [activeTab, setActiveTab] = useState('incidents');
  const [ruleModalOpen, setRuleModalOpen] = useState(false);

  // Mock Incidents
  const [incidents, setIncidents] = useState([
    {
      id: 'inc-01',
      rule_name: 'Router Offline (3 Heartbeats Missed)',
      severity: 'CRITICAL',
      device_name: 'Substation Inverter #3',
      serial_number: 'NSV-2S-2026-00414',
      status: 'ACTIVE',
      message: 'Router disconnected unexpectedly from Airtel 4G cell tower. LWT trigger fired.',
      triggered_at: '1 hour ago',
    },
    {
      id: 'inc-02',
      rule_name: 'Cellular Signal Drop (Marginal RF)',
      severity: 'WARNING',
      device_name: 'Solar Site 02 Gateway',
      serial_number: 'NSV-2S-2026-00413',
      status: 'ACKNOWLEDGED',
      message: 'Cellular RSSI degraded to 54 dBm due to heavy rain. Signal quality marginal.',
      triggered_at: '3 hours ago',
    },
    {
      id: 'inc-03',
      rule_name: 'Monthly Cellular Data Quota (80%)',
      severity: 'INFO',
      device_name: 'Solar Site 01 Gateway',
      serial_number: 'NSV-2S-2026-00412',
      status: 'RESOLVED',
      message: 'Device consumed 20.1 GB / 25 GB monthly quota. Quota reset scheduled for 1st of month.',
      triggered_at: '1 day ago',
    },
  ]);

  // Mock Rules
  const [rules, setRules] = useState([
    {
      id: 'rule-01',
      name: 'Anti-Theft SIM Swap / IMEI Mismatch',
      trigger_type: 'SIM_SWAP_IMEI_MISMATCH',
      severity: 'CRITICAL',
      threshold_desc: 'Triggers immediately if SIM IMSI changes or IMEI differs from factory profile',
      channels: ['SLACK', 'TELEGRAM', 'EMAIL'],
      is_active: true,
    },
    {
      id: 'rule-02',
      name: 'Cellular Signal Drop (Marginal RF)',
      trigger_type: 'CELLULAR_RSSI_DROP',
      severity: 'WARNING',
      threshold_desc: 'RSSI < 60 or fallback from LTE to 2G/EDGE for > 10 minutes',
      channels: ['SLACK'],
      is_active: true,
    },
    {
      id: 'rule-03',
      name: 'Router Offline (3 Heartbeats Missed)',
      trigger_type: 'DEVICE_OFFLINE',
      severity: 'CRITICAL',
      threshold_desc: 'Device misses 3 consecutive 60s heartbeats (180s silence)',
      channels: ['SLACK', 'TELEGRAM'],
      is_active: true,
    },
    {
      id: 'rule-04',
      name: 'Monthly Cellular Data Quota (80% & 100%)',
      trigger_type: 'DATA_QUOTA_REACHED',
      severity: 'WARNING',
      threshold_desc: 'WAN interface traffic exceeds 20 GB of 25 GB monthly allowance',
      channels: ['EMAIL'],
      is_active: true,
    },
  ]);

  const handleAcknowledge = (id: string) => {
    setIncidents(
      incidents.map((inc) => (inc.id === id ? { ...inc, status: 'ACKNOWLEDGED' } : inc))
    );
    message.success('Alarm acknowledged');
  };

  const handleResolve = (id: string) => {
    setIncidents(
      incidents.map((inc) => (inc.id === id ? { ...inc, status: 'RESOLVED' } : inc))
    );
    message.success('Alarm marked as resolved');
  };

  const handleCreateRule = (values: any) => {
    const newRule = {
      id: `rule-${Date.now().toString().slice(-4)}`,
      name: values.name,
      trigger_type: values.trigger_type,
      severity: values.severity,
      threshold_desc: values.threshold_desc || 'Custom alert condition',
      channels: values.channels || ['SLACK'],
      is_active: true,
    };
    setRules([...rules, newRule]);
    setRuleModalOpen(false);
    message.success('Alert rule created!');
  };

  const incidentColumns = [
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      width: 120,
      render: (sev: string) => {
        if (sev === 'CRITICAL') return <Tag color="error" icon={<CloseCircleOutlined />}>CRITICAL</Tag>;
        if (sev === 'WARNING') return <Tag color="warning" icon={<ExclamationCircleOutlined />}>WARNING</Tag>;
        return <Tag color="blue" icon={<CheckCircleOutlined />}>INFO</Tag>;
      },
    },
    {
      title: 'Device & Location',
      key: 'device',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827' }}>{record.device_name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.serial_number}</div>
        </div>
      ),
    },
    {
      title: 'Alarm Details',
      key: 'details',
      render: (_: any, record: any) => (
        <div>
          <strong style={{ color: '#111827' }}>{record.rule_name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.message}</div>
        </div>
      ),
    },
    {
      title: 'Triggered',
      dataIndex: 'triggered_at',
      key: 'triggered_at',
      render: (t: string) => <span style={{ color: '#6b7280' }}>{t}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (st: string) => {
        if (st === 'ACTIVE') return <Tag color="red">● ACTIVE</Tag>;
        if (st === 'ACKNOWLEDGED') return <Tag color="orange">ACKNOWLEDGED</Tag>;
        return <Tag color="success">RESOLVED</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space size={4}>
          {record.status === 'ACTIVE' && (
            <Button size="small" onClick={() => handleAcknowledge(record.id)}>
              Acknowledge
            </Button>
          )}
          {record.status !== 'RESOLVED' && (
            <Button size="small" type="primary" ghost onClick={() => handleResolve(record.id)}>
              Resolve
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const ruleColumns = [
    {
      title: 'Rule Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: any) => (
        <div>
          <strong style={{ color: '#111827' }}>{name}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{record.threshold_desc}</div>
        </div>
      ),
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: (sev: string) => {
        if (sev === 'CRITICAL') return <Tag color="error">CRITICAL</Tag>;
        if (sev === 'WARNING') return <Tag color="warning">WARNING</Tag>;
        return <Tag color="blue">INFO</Tag>;
      },
    },
    {
      title: 'Dispatch Channels',
      dataIndex: 'channels',
      key: 'channels',
      render: (channels: string[]) => (
        <Space size={4}>
          {channels.map((ch) => (
            <Tag key={ch} color="purple">{ch}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => <Switch defaultChecked={active} />,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: '#111827', fontWeight: 600 }}>Alerts & Notification Rules</h2>
          <span style={{ color: '#6b7280', fontSize: 13 }}>
            Automated RF monitoring, anti-theft SIM swap alerts, and multi-channel webhook dispatch
          </span>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setRuleModalOpen(true)}>
          + Create Alert Rule
        </Button>
      </div>

      {/* Top Alarm Overview Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Active Incidents"
              value={1}
              suffix="/ 3 Total"
              valueStyle={{ color: '#ef4444', fontWeight: 600 }}
              prefix={<AlertOutlined />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              1 Critical router offline alarm requires attention
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Active Monitoring Rules"
              value={4}
              suffix="Rules"
              valueStyle={{ color: '#2e90fa', fontWeight: 600 }}
              prefix={<BellOutlined />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Monitoring RSSI, SIM changes, heartbeats & bandwidth
            </div>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title="Dispatched Notifications (Today)"
              value={3}
              valueStyle={{ color: '#10b981', fontWeight: 600 }}
              prefix={<SendOutlined />}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Delivered to Slack and Telegram webhook endpoints
            </div>
          </Card>
        </Col>
      </Row>

      <Card bordered bodyStyle={{ padding: '8px 16px' }} style={{ borderColor: '#e5e7eb' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'incidents',
              label: (
                <span>
                  <AlertOutlined /> Active Incidents & Alarms ({incidents.filter((i) => i.status !== 'RESOLVED').length})
                </span>
              ),
              children: (
                <Table columns={incidentColumns} dataSource={incidents} rowKey="id" pagination={false} />
              ),
            },
            {
              key: 'rules',
              label: (
                <span>
                  <BellOutlined /> Alert Rules & Policies ({rules.length})
                </span>
              ),
              children: (
                <Table columns={ruleColumns} dataSource={rules} rowKey="id" pagination={false} />
              ),
            },
            {
              key: 'channels',
              label: (
                <span>
                  <SendOutlined /> Notification Webhooks
                </span>
              ),
              children: (
                <Row gutter={[16, 16]} style={{ padding: '16px 0' }}>
                  <Col xs={24} md={12}>
                    <Card title="Slack Incoming Webhook" size="small" bordered style={{ borderColor: '#e5e7eb' }}>
                      <Form layout="vertical">
                        <Form.Item label="Webhook URL">
                          <Input defaultValue="https://hooks.slack.com/services/T00/B00/XNET2026" />
                        </Form.Item>
                        <Form.Item label="Channel">
                          <Input defaultValue="#solar-plant-alarms" />
                        </Form.Item>
                        <Button
                          type="primary"
                          ghost
                          size="small"
                          onClick={() => message.success('Test alert sent to Slack #solar-plant-alarms!')}
                        >
                          Send Test Notification
                        </Button>
                      </Form>
                    </Card>
                  </Col>
                  <Col xs={24} md={12}>
                    <Card title="Telegram Bot Alerts" size="small" bordered style={{ borderColor: '#e5e7eb' }}>
                      <Form layout="vertical">
                        <Form.Item label="Bot Token">
                          <Input.Password defaultValue="bot7892348:AAH3k_XNET_TelegramBot" />
                        </Form.Item>
                        <Form.Item label="Chat ID">
                          <Input defaultValue="-100182736452" />
                        </Form.Item>
                        <Button
                          type="primary"
                          ghost
                          size="small"
                          onClick={() => message.success('Test alert sent to Telegram chat!')}
                        >
                          Send Test Notification
                        </Button>
                      </Form>
                    </Card>
                  </Col>
                </Row>
              ),
            },
          ]}
        />
      </Card>

      {/* Create Rule Modal */}
      <Modal
        title="Create Real-Time Alert Rule"
        open={ruleModalOpen}
        onCancel={() => setRuleModalOpen(false)}
        footer={null}
        width={500}
      >
        <Form layout="vertical" onFinish={handleCreateRule} initialValues={{ severity: 'WARNING', trigger_type: 'CELLULAR_RSSI_DROP' }}>
          <Form.Item label="Rule Display Name" name="name" rules={[{ required: true, message: 'Please enter rule name' }]}>
            <Input placeholder="e.g. Gujarat Solar RSSI Drop Alert" />
          </Form.Item>

          <Form.Item label="Trigger Condition" name="trigger_type">
            <Select
              options={[
                { value: 'CELLULAR_RSSI_DROP', label: 'Cellular Signal Degradation (RSSI < 60)' },
                { value: 'SIM_SWAP_IMEI_MISMATCH', label: 'Theft Detection (SIM Card Swap / IMEI Mismatch)' },
                { value: 'DEVICE_OFFLINE', label: 'Connection Loss (3 Missed Heartbeats)' },
                { value: 'DATA_QUOTA_REACHED', label: 'Cellular Bandwidth Limit (80% / 100% Quota)' },
              ]}
            />
          </Form.Item>

          <Form.Item label="Severity Level" name="severity">
            <Radio.Group>
              <Radio.Button value="CRITICAL">Critical</Radio.Button>
              <Radio.Button value="WARNING">Warning</Radio.Button>
              <Radio.Button value="INFO">Info</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item label="Dispatch Webhook Channels" name="channels">
            <Select
              mode="multiple"
              defaultValue={['SLACK', 'TELEGRAM']}
              options={[
                { value: 'SLACK', label: 'Slack Webhook' },
                { value: 'TELEGRAM', label: 'Telegram Bot' },
                { value: 'EMAIL', label: 'Email Notification' },
              ]}
            />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <Button onClick={() => setRuleModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit">
              Save Alert Rule
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};
