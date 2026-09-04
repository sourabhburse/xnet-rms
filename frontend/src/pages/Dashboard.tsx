import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Progress, Tag, Table, Spin } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import { getDashboardSummary, DashboardSummary } from '../services/api';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardSummary()
      .then((data) => setSummary(data))
      .catch(() => {
        setSummary({
          total_devices: 42,
          online_devices: 40,
          offline_devices: 2,
          active_tunnels: 3,
          data_usage_gb: 18.4,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const carrierData = [
    { name: 'Airtel 4G', value: 24, color: '#2e90fa' },
    { name: 'Jio LTE', value: 14, color: '#10b981' },
    { name: 'Vodafone', value: 4, color: '#f59e0b' },
  ];

  const recentAlerts = [
    { key: '1', time: '10m ago', device: 'Router-Solar-Site14', alert: 'Device went OFFLINE (missed 3 heartbeats)', type: 'error' },
    { key: '2', time: '42m ago', device: 'Router-Solar-Site02', alert: 'SIM Data quota exceeded 80% (16.2 GB / 20 GB)', type: 'warning' },
    { key: '3', time: '2h ago', device: 'Router-Solar-Site08', alert: 'Router rebooted successfully after scheduled update', type: 'success' },
  ];

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  const onlinePct = summary ? Math.round((summary.online_devices / (summary.total_devices || 1)) * 100) : 0;

  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', color: '#111827', fontWeight: 600 }}>Fleet Health & Overview</h2>

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

      {/* Cellular Distribution & Health Breakdown */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Cellular Carrier Distribution" bordered style={{ borderColor: '#e5e7eb' }}>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={carrierData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label>
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
                <span style={{ color: '#4b5563' }}>Excellent Signal (RSSI &gt; 80 / RSRP &gt; -85 dBm)</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>72%</span>
              </div>
              <Progress percent={72} strokeColor="#10b981" showInfo={false} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#4b5563' }}>Good Signal (RSSI 60-80)</span>
                <span style={{ color: '#2e90fa', fontWeight: 600 }}>22%</span>
              </div>
              <Progress percent={22} strokeColor="#2e90fa" showInfo={false} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#4b5563' }}>Poor / Marginal Signal</span>
                <span style={{ color: '#f43f5e', fontWeight: 600 }}>6%</span>
              </div>
              <Progress percent={6} strokeColor="#f43f5e" showInfo={false} />
            </div>

            <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280', fontSize: 13 }}>Total Fleet Data Consumed This Month:</span>
              <h3 style={{ margin: '4px 0 0 0', color: '#111827' }}>{summary?.data_usage_gb} GB / 100 GB Quota</h3>
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
