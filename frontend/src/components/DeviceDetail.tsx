import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  GlobalOutlined,
  CodeOutlined,
  SafetyCertificateOutlined,
  LineChartOutlined,
  StopOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Device, SnapshotSource, User } from '../types';
import { api, formatApiError, ApiError } from '../api';

interface DeviceDetailProps {
  device: Device;
  user: User;
  onBack: () => void;
  onRefreshDevice: () => void;
}

export default function DeviceDetail({
  device,
  user,
  onBack,
  onRefreshDevice,
}: DeviceDetailProps) {
  const [snapshots, setSnapshots] = useState<SnapshotSource[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [selectedField, setSelectedField] = useState<string>('');
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<{
    type: 'success' | 'warning' | 'info' | 'error';
    title: string;
    message: string;
    launchUrl?: string;
    sessionId?: string;
  } | null>(null);

  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const canOperate = user.role !== 'VIEWER';

  const loadSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      const data = await api<SnapshotSource[]>(`devices/${device.id}/snapshots`);
      setSnapshots(data || []);
      if (!selectedSource && data && data.length > 0) {
        setSelectedSource(data[0].source_id);
      }
    } catch (err) {
      const formatted = formatApiError(err);
      message.error(formatted.message);
    } finally {
      setLoadingSnapshots(false);
    }
  };

  const loadHistory = async (sourceId: string) => {
    if (!sourceId) return;
    setLoadingHistory(true);
    try {
      const data = await api<any[]>(
        `devices/${device.id}/history?source=${encodeURIComponent(sourceId)}`
      );
      setHistoryData(data || []);
    } catch (err) {
      const formatted = formatApiError(err);
      message.error(formatted.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadSnapshots();
    const timer = setInterval(loadSnapshots, 30000);
    return () => clearInterval(timer);
  }, [device.id]);

  useEffect(() => {
    if (selectedSource) {
      loadHistory(selectedSource);
    }
  }, [selectedSource, device.id]);

  const handleOpenLuCI = async () => {
    setSessionLoading(true);
    setSessionNotice(null);
    try {
      const res = await api<{ id: string; expires_at: string; launch_url: string }>(
        'sessions',
        'POST',
        { device_id: device.id, protocol: 'SSH_LUCI' }
      );
      window.open(res.launch_url, '_blank');
      setSessionNotice({
        type: 'success',
        title: 'LuCI Session Launched',
        message:
          'LuCI WebUI is opening in a new tab via server-side SSH tunnel. If it was blocked by your browser, click below.',
        launchUrl: res.launch_url,
        sessionId: res.id,
      });
    } catch (err) {
      const formatted = formatApiError(err);
      setSessionNotice({
        type: formatted.type,
        title: formatted.title,
        message: formatted.message,
      });
    } finally {
      setSessionLoading(false);
    }
  };

  const handleOpenTerminal = async () => {
    setSessionLoading(true);
    setSessionNotice(null);
    try {
      const res = await api<{ id: string; expires_at: string; launch_url: string }>(
        'sessions',
        'POST',
        { device_id: device.id, protocol: 'TERMINAL_SSH' }
      );
      window.open(res.launch_url, '_blank');
      setSessionNotice({
        type: 'success',
        title: 'Terminal Session Launched',
        message: 'Web terminal is opening in a new tab.',
        launchUrl: res.launch_url,
        sessionId: res.id,
      });
    } catch (err) {
      const formatted = formatApiError(err);
      setSessionNotice({
        type: formatted.type,
        title: formatted.title,
        message: formatted.message,
      });
    } finally {
      setSessionLoading(false);
    }
  };

  const handleRevokeDevice = () => {
    Modal.confirm({
      title: 'Revoke this router’s access?',
      content:
        'This action is irreversible. The router certificate will be revoked immediately and cannot reconnect.',
      okText: 'Revoke Device',
      okType: 'danger',
      onOk: async () => {
        try {
          await api(`devices/${device.id}/revoke`, 'POST', {});
          message.success('Device revoked successfully');
          onBack();
        } catch (err) {
          const formatted = formatApiError(err);
          message.error(formatted.message);
        }
      },
    });
  };

  const currentSource = snapshots.find(s => s.source_id === selectedSource);
  const currentFields = currentSource?.fields || {};
  const numericFieldOptions = Object.entries(currentFields)
    .filter(([, v]) => v.kind === 'gauge' || v.kind === 'counter')
    .map(([id, v]) => ({ value: id, label: v.label || id }));

  const chartData = [...historyData].reverse().map(h => ({
    time: new Date(h.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: selectedField ? h.fields?.[selectedField]?.value : undefined,
  }));

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            Back to Fleet
          </Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {device.serial_number}
          </Typography.Title>
          <span
            className={`status-pill ${
              device.status === 'ONLINE'
                ? 'status-online'
                : device.status === 'REVOKED'
                ? 'status-revoked'
                : 'status-offline'
            }`}
          >
            <span className="status-dot" /> {device.status}
          </span>
        </Space>

        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadSnapshots} loading={loadingSnapshots}>
            Refresh Telemetry
          </Button>
          {isSuperAdmin && !device.revoked && (
            <Button danger icon={<StopOutlined />} onClick={handleRevokeDevice}>
              Revoke Device
            </Button>
          )}
        </Space>
      </div>

      {sessionNotice && (
        <Alert
          type={sessionNotice.type}
          showIcon
          style={{ marginBottom: 20 }}
          message={sessionNotice.title}
          description={
            <div>
              <p style={{ margin: '4px 0' }}>{sessionNotice.message}</p>
              {sessionNotice.launchUrl && (
                <Space style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    href={sessionNotice.launchUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Session Tab
                  </Button>
                  {sessionNotice.sessionId && (
                    <Button
                      size="small"
                      danger
                      onClick={async () => {
                        try {
                          await api(`sessions/${sessionNotice.sessionId}`, 'DELETE');
                          setSessionNotice(null);
                          message.success('Session closed');
                        } catch (err) {
                          const formatted = formatApiError(err);
                          message.error(formatted.message);
                        }
                      }}
                    >
                      Close Session
                    </Button>
                  )}
                </Space>
              )}
            </div>
          }
          closable
          onClose={() => setSessionNotice(null)}
        />
      )}

      {/* Remote Access Card */}
      <Card
        className="rms-card"
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#0284c7' }} />
            <span>Remote Management (RMS Connect)</span>
          </Space>
        }
        bordered={false}
        style={{ marginBottom: 20 }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <div>
            <Button
              type="primary"
              size="large"
              icon={<GlobalOutlined />}
              onClick={handleOpenLuCI}
              loading={sessionLoading}
              disabled={!canOperate || device.status !== 'ONLINE'}
              style={{ background: '#0284c7', borderColor: '#0284c7' }}
            >
              Open LuCI
            </Button>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              Zero-configuration router web interface via server-side LuCI
            </div>
          </div>

          <div>
            <Button
              size="large"
              icon={<CodeOutlined />}
              onClick={handleOpenTerminal}
              loading={sessionLoading}
              disabled={!canOperate || device.status !== 'ONLINE'}
            >
              Open Terminal
            </Button>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              Interactive SSH shell in your browser
            </div>
          </div>
        </div>
      </Card>

      {/* Detail Tabs */}
      <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: 'Device Overview',
            children: (
              <Card className="rms-card" bordered={false}>
                <Descriptions bordered column={{ xs: 1, sm: 2, md: 3 }}>
                  <Descriptions.Item label="Serial Number">
                    <span className="code-font" style={{ fontWeight: 600 }}>
                      {device.serial_number}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="Device Name">
                    {device.name || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="LAN MAC Address">
                    <span className="code-font">{device.lan_mac || '—'}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label="Model">
                    {device.model || 'Niseva 2S Router'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Firmware Version">
                    {device.firmware_version ? `v${device.firmware_version}` : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Last Communication">
                    {device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Never'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Customer Tags" span={3}>
                    {device.tags && device.tags.length > 0 ? (
                      <Space wrap>
                        {device.tags.map(t => (
                          <Tag color="blue" key={t}>
                            {t}
                          </Tag>
                        ))}
                      </Space>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>No tags assigned</span>
                    )}
                  </Descriptions.Item>
                  <Descriptions.Item label="Internal ID" span={3}>
                    <span className="code-font" style={{ fontSize: 11, color: '#64748b' }}>
                      {device.id}
                    </span>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            ),
          },
          {
            key: 'telemetry',
            label: `Telemetry Snapshots (${snapshots.length})`,
            children: (
              <div>
                {snapshots.length === 0 ? (
                  <Card className="rms-card" bordered={false}>
                    <Alert
                      message="No telemetry snapshots collected yet."
                      description="Assign a monitoring profile to this device to collect periodic telemetry."
                      type="info"
                      showIcon
                    />
                  </Card>
                ) : (
                  snapshots.map(s => (
                    <Card
                      key={s.source_id}
                      className="rms-card"
                      title={
                        <Space>
                          <span>{s.definition?.name || s.source_id}</span>
                          <Tag color={s.status === 'ok' ? 'green' : 'red'}>{s.status}</Tag>
                          <span
                            style={{
                              fontSize: 12,
                              color: s.stale ? '#dc2626' : '#16a34a',
                              fontWeight: 500,
                            }}
                          >
                            {s.stale ? 'Stale' : 'Fresh'}
                          </span>
                        </Space>
                      }
                      extra={
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          Observed {new Date(s.observed_at).toLocaleString()}
                        </span>
                      }
                      bordered={false}
                      style={{ marginBottom: 16 }}
                    >
                      {s.error && <Alert type="error" message={s.error} style={{ marginBottom: 16 }} />}
                      <Table
                        size="small"
                        rowKey="field_id"
                        pagination={false}
                        dataSource={Object.entries(s.fields || {}).map(([id, f]) => ({
                          field_id: id,
                          label: f.label || id,
                          value: String(f.value ?? '—'),
                          unit: f.unit || '',
                          kind: f.kind || 'text',
                        }))}
                        columns={[
                          { title: 'Metric', dataIndex: 'label', key: 'label' },
                          {
                            title: 'Current Value',
                            key: 'value',
                            render: (_, row) => (
                              <span style={{ fontWeight: 600 }}>
                                {row.value} {row.unit}
                              </span>
                            ),
                          },
                          {
                            title: 'Type',
                            dataIndex: 'kind',
                            key: 'kind',
                            render: (k: string) => (
                              <Tag color="geekblue" style={{ textTransform: 'capitalize' }}>
                                {k}
                              </Tag>
                            ),
                          },
                        ]}
                      />
                    </Card>
                  ))
                )}
              </div>
            ),
          },
          {
            key: 'charts',
            label: 'Historical Charts',
            children: (
              <Card className="rms-card" bordered={false}>
                <Space wrap style={{ marginBottom: 20 }}>
                  <Select
                    aria-label="Select telemetry source"
                    placeholder="Select telemetry source"
                    style={{ width: 240 }}
                    value={selectedSource || undefined}
                    onChange={v => {
                      setSelectedSource(v);
                      setSelectedField('');
                    }}
                    options={snapshots.map(s => ({
                      value: s.source_id,
                      label: s.definition?.name || s.source_id,
                    }))}
                  />

                  <Select
                    aria-label="Select metric field"
                    placeholder="Select metric to plot"
                    style={{ width: 240 }}
                    value={selectedField || undefined}
                    onChange={setSelectedField}
                    options={numericFieldOptions}
                    disabled={!selectedSource || numericFieldOptions.length === 0}
                  />
                </Space>

                {selectedField ? (
                  <div style={{ height: 280, width: '100%', marginBottom: 24 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="time" stroke="#64748b" />
                        <YAxis stroke="#64748b" />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#0284c7"
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Alert
                    message="Select a numeric metric above to view the historical time-series chart."
                    type="info"
                    style={{ marginBottom: 20 }}
                  />
                )}

                <Typography.Title level={5}>Snapshot History Log</Typography.Title>
                <Table
                  size="small"
                  rowKey="observed_at"
                  loading={loadingHistory}
                  dataSource={historyData.slice(0, 50)}
                  columns={[
                    {
                      title: 'Observed Time',
                      dataIndex: 'observed_at',
                      render: t => new Date(t).toLocaleString(),
                    },
                    {
                      title: 'Status',
                      dataIndex: 'status',
                      render: s => <Tag color={s === 'ok' ? 'green' : 'red'}>{s}</Tag>,
                    },
                    {
                      title: 'Values Snapshot',
                      render: (_, row) => (
                        <span className="code-font" style={{ fontSize: 11 }}>
                          {JSON.stringify(row.fields)}
                        </span>
                      ),
                    },
                  ]}
                  pagination={{ pageSize: 10 }}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
