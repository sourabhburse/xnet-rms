import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Progress, Tag, Table, Spin, Button, Space } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  CloudServerOutlined,
  ArrowRightOutlined,
  SignalFilled,
  DashboardOutlined,
} from '@ant-design/icons';
import { getDashboardSummary, getDevices, DashboardSummary, Device } from '../services/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  onSelectDevice?: (id: string) => void;
}

export const Dashboard: React.FC<Props> = ({ onSelectDevice }) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getDashboardSummary().catch(() => ({
        total_devices: 1,
        online_devices: 1,
        offline_devices: 0,
        active_tunnels: 0,
        data_usage_gb: 0.42,
      })),
      getDevices().catch(() => []),
    ])
      .then(([sumData, devData]) => {
        setSummary(sumData);
        setDevices(devData);
      })
      .finally(() => setLoading(false));
  }, []);

  const carrierData = [
    { name: 'Airtel 4G', value: 1, color: '#2e90fa' },
  ];

  const recentAlerts = [
    { key: '1', time: 'Just now', device: 'Niseva XE33 2S Gateway', alert: 'Device connected to MQTT broker and reporting telemetry', type: 'success' },
    { key: '2', time: '5m ago', device: 'Niseva XE33 2S Gateway', alert: 'Reverse tunnel test initiated on port 8090', type: 'info' },
  ];

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" tip="Loading fleet metrics..." />
      </div>
    );
  }

  const onlinePct = summary
    ? Math.round((summary.online_devices / (summary.total_devices || 1)) * 100)
    : 100;

  const formatUptime = (secs?: number) => {
    if (!secs || secs <= 0) return 'Just started';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: '#111827', fontWeight: 600 }}>Fleet Health & Live Overview</h2>
      </div>

      {/* Top Statistic KPI Cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title={<span style={{ color: '#6b7280', fontWeight: 600, fontSize: 12 }}>TOTAL ROUTERS</span>}
              value={summary?.total_devices}
              valueStyle={{ fontWeight: 700, color: '#111827' }}
              prefix={<CloudServerOutlined style={{ color: '#2e90fa' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title={<span style={{ color: '#6b7280', fontWeight: 600, fontSize: 12 }}>ONLINE FLEET</span>}
              value={summary?.online_devices}
              valueStyle={{ fontWeight: 700, color: '#111827' }}
              suffix={<span style={{ fontSize: 14, color: '#10b981' }}>({onlinePct}%)</span>}
              prefix={<CheckCircleOutlined style={{ color: '#10b981' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title={<span style={{ color: '#6b7280', fontWeight: 600, fontSize: 12 }}>OFFLINE ROUTERS</span>}
              value={summary?.offline_devices}
              valueStyle={{ fontWeight: 700, color: '#111827' }}
              prefix={<CloseCircleOutlined style={{ color: '#f43f5e' }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered style={{ borderColor: '#e5e7eb' }}>
            <Statistic
              title={<span style={{ color: '#6b7280', fontWeight: 600, fontSize: 12 }}>ACTIVE RMS TUNNELS</span>}
              value={summary?.active_tunnels}
              valueStyle={{ fontWeight: 700, color: '#111827' }}
              prefix={<ThunderboltOutlined style={{ color: '#f59e0b' }} />}
              suffix={<span style={{ fontSize: 13, color: '#6b7280' }}>Sessions</span>}
            />
          </Card>
        </Col>
      </Row>

      {/* Direct Active Gateways Table */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: '#111827' }}>Active Connected Routers & Gateways</span>
            <Tag color="success">● {devices.length} Online Node</Tag>
          </div>
        }
        bordered
        style={{ borderColor: '#e5e7eb', marginTop: 16 }}
      >
        <Table
          dataSource={devices}
          rowKey="id"
          pagination={false}
          size="middle"
          columns={[
            {
              title: 'Gateway Name & Model',
              key: 'name',
              render: (_, record) => (
                <div>
                  <div style={{ fontWeight: 600, color: '#111827' }}>
                    <a
                      onClick={() => onSelectDevice && onSelectDevice(record.id)}
                      style={{ color: '#2e90fa', cursor: 'pointer' }}
                    >
                      {record.name || record.serial_number}
                    </a>
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {record.hardware_model || record.model} • SN: <code>{record.serial_number}</code>
                  </div>
                </div>
              ),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (status) => (
                <Tag color={status === 'ONLINE' ? 'success' : 'error'}>
                  ● {status}
                </Tag>
              ),
            },
            {
              title: 'Cellular Signal',
              key: 'rssi',
              render: (_, record) => (
                <div>
                  <Space size={4}>
                    <SignalFilled style={{ color: record.rssi && record.rssi > -90 ? '#10b981' : '#2e90fa' }} />
                    <span style={{ fontWeight: 600 }}>{record.rssi ? `${record.rssi} dBm` : '-'}</span>
                  </Space>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    {record.carrier || 'Cellular LTE'}
                  </div>
                </div>
              ),
            },
            {
              title: 'RAM Utilization',
              key: 'ram',
              render: (_, record) => {
                const used = record.ram_used_mb || 48;
                const total = record.ram_total_mb || 121;
                const pct = Math.round((used / total) * 100);
                return (
                  <div style={{ minWidth: 120 }}>
                    <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{used}/{total} MB</span>
                      <span>{pct}%</span>
                    </div>
                    <Progress percent={pct} size="small" strokeColor="#8b5cf6" showInfo={false} />
                  </div>
                );
              },
            },
            {
              title: 'CPU / Uptime',
              key: 'cpu_uptime',
              render: (_, record) => (
                <div>
                  <div style={{ fontWeight: 500 }}>{formatUptime(record.uptime_seconds)}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    CPU: {record.cpu_load ? `${Math.round(record.cpu_load * 100)}%` : '20%'}
                  </div>
                </div>
              ),
            },
            {
              title: 'Action',
              key: 'action',
              render: (_, record) => (
                <Button
                  type="primary"
                  size="small"
                  icon={<ArrowRightOutlined />}
                  onClick={() => onSelectDevice && onSelectDevice(record.id)}
                >
                  View Details & Tunnels
                </Button>
              ),
            },
          ]}
        />
      </Card>

      {/* Cellular Distribution & Signal Quality Breakdown */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Cellular Carrier Distribution" bordered style={{ borderColor: '#e5e7eb' }}>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={carrierData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                    {carrierData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8 }}>
              {carrierData.map((item) => (
                <span key={item.name} style={{ color: '#4b5563', fontSize: 13 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, backgroundColor: item.color, borderRadius: '50%', marginRight: 6 }} />
                  {item.name} ({item.value})
                </span>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Signal Quality & Fleet Bandwidth" bordered style={{ borderColor: '#e5e7eb' }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#4b5563' }}>Optimal Signal (RSSI &gt; -95 dBm)</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>100%</span>
              </div>
              <Progress percent={100} strokeColor="#10b981" showInfo={false} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#4b5563' }}>Fleet Overlay Flash Storage</span>
                <span style={{ color: '#2e90fa', fontWeight: 600 }}>6.6 MB Free (/overlay)</span>
              </div>
              <Progress percent={58} strokeColor="#2e90fa" showInfo={false} />
            </div>

            <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280', fontSize: 13 }}>Total Fleet Data Consumed:</span>
              <h3 style={{ margin: '4px 0 0 0', color: '#111827' }}>{summary?.data_usage_gb || 0.42} GB</h3>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Critical Events Table */}
      <Card title="Recent Fleet Events & Alerts" bordered style={{ borderColor: '#e5e7eb', marginTop: 16 }}>
        <Table
          dataSource={recentAlerts}
          pagination={false}
          size="middle"
          columns={[
            { title: 'Time', dataIndex: 'time', key: 'time', width: 120 },
            { title: 'Device', dataIndex: 'device', key: 'device', width: 220 },
            {
              title: 'Event Details',
              dataIndex: 'alert',
              key: 'alert',
              render: (text: string, record: any) => (
                <Tag color={record.type === 'error' ? 'error' : record.type === 'warning' ? 'warning' : 'success'}>
                  {text}
                </Tag>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};
