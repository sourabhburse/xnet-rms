import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  UploadOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { Organization, TagItem, User } from '../types';
import { api, formatApiError } from '../api';

interface AddDevicesProps {
  user: User;
  organizations: Organization[];
  tags: TagItem[];
  selectedOrg: string;
  onSuccess: () => void;
  onRefreshTags: () => void;
}

interface ManualRow {
  key: string;
  name: string;
  serial_number: string;
  lan_mac: string;
  tags: string[];
}

const emptyRow = (): ManualRow => ({
  key: Math.random().toString(36).substring(7),
  name: '',
  serial_number: '',
  lan_mac: '',
  tags: [],
});

export default function AddDevices({
  user,
  organizations,
  tags,
  selectedOrg,
  onSuccess,
  onRefreshTags,
}: AddDevicesProps) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const [org, setOrg] = useState<string>(selectedOrg || user.organization_id || '');
  const [manualRows, setManualRows] = useState<ManualRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [submissionResults, setSubmissionResults] = useState<any[]>([]);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const [csvValidating, setCsvValidating] = useState(false);
  const [formError, setFormError] = useState<string>('');

  useEffect(() => {
    if (selectedOrg) setOrg(selectedOrg);
  }, [selectedOrg]);

  const availableTags = (tags || []).filter(t => !org || t.organization_id === org);
  const tagOptions = availableTags.map(t => ({ label: t.name, value: t.name }));

  const addRow = () => {
    if (manualRows.length >= 500) {
      message.warning('Maximum 500 rows allowed per registration request.');
      return;
    }
    setManualRows([...manualRows, emptyRow()]);
  };

  const removeRow = (key: string) => {
    if (manualRows.length === 1) {
      setManualRows([emptyRow()]);
      return;
    }
    setManualRows(manualRows.filter(r => r.key !== key));
  };

  const updateRow = (key: string, field: keyof ManualRow, value: any) => {
    setManualRows(
      manualRows.map(r => (r.key === key ? { ...r, [field]: value } : r))
    );
  };

  const handleManualSubmit = async () => {
    setFormError('');
    if (!org) {
      setFormError('Organization is required. Please select an organization.');
      return;
    }

    // Filter out completely blank rows
    const filledRows = manualRows.filter(
      r => r.serial_number.trim() || r.lan_mac.trim() || r.name.trim()
    );

    if (filledRows.length === 0) {
      setFormError('Please enter at least one device with serial number and LAN MAC.');
      return;
    }

    for (let i = 0; i < filledRows.length; i++) {
      const r = filledRows[i];
      if (!r.serial_number.trim()) {
        setFormError(`Row ${i + 1}: Serial number is required.`);
        return;
      }
      if (!r.lan_mac.trim()) {
        setFormError(`Row ${i + 1}: LAN MAC address is required.`);
        return;
      }
    }

    setSubmitting(true);
    setSubmissionResults([]);
    try {
      const payload = {
        organization_id: org,
        rows: filledRows.map(r => ({
          name: r.name.trim(),
          serial_number: r.serial_number.trim(),
          lan_mac: r.lan_mac.trim(),
          tags: r.tags || [],
        })),
      };
      const results = await api<any[]>('registrations', 'POST', payload);
      setSubmissionResults(results);

      const allSuccess = results.every(r => r.success);
      if (allSuccess) {
        message.success(`Successfully registered ${results.length} devices!`);
        setManualRows([emptyRow()]);
        onSuccess();
        onRefreshTags();
      } else {
        const failedIndices = results
          .map((r, i) => (!r.success ? i : null))
          .filter(i => i !== null) as number[];
        setManualRows(filledRows.filter((_, i) => failedIndices.includes(i)));
        message.warning('Some rows had conflicts or invalid formats. Check results below.');
      }
    } catch (err) {
      const formatted = formatApiError(err);
      setFormError(formatted.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvUpload = async (file: File) => {
    setFormError('');
    setCsvPreview([]);
    if (!org) {
      setFormError('Please select a customer organization before uploading CSV.');
      return;
    }
    if (file.size > 1048576) {
      setFormError('CSV file size exceeds 1 MiB limit.');
      return;
    }

    setCsvValidating(true);
    try {
      const text = await file.text();
      const preview = await api<any[]>(
        `registrations/preview?organization_id=${encodeURIComponent(org)}`,
        'POST',
        text,
        true
      );
      setCsvPreview(preview);
    } catch (err) {
      const formatted = formatApiError(err);
      setFormError(formatted.message);
    } finally {
      setCsvValidating(false);
    }
  };

  const handleCsvConfirm = async () => {
    const validRows = csvPreview.filter(r => r.valid).map(r => r.data);
    if (validRows.length === 0) {
      message.warning('No valid rows to register.');
      return;
    }

    setSubmitting(true);
    try {
      const results = await api<any[]>('registrations', 'POST', {
        organization_id: org,
        rows: validRows,
      });
      setSubmissionResults(results);
      message.success(`Registered ${results.filter(r => r.success).length} devices!`);
      setCsvPreview([]);
      onSuccess();
      onRefreshTags();
    } catch (err) {
      const formatted = formatApiError(err);
      setFormError(formatted.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <Typography.Title level={3} className="page-title">
            Add Devices to Fleet
          </Typography.Title>
          <div className="page-subtitle">
            Pre-register routers by Serial Number and LAN MAC address to allow instant auto-provisioning.
          </div>
        </div>
      </div>

      {formError && (
        <Alert
          type="error"
          message={formError}
          showIcon
          closable
          style={{ marginBottom: 20 }}
          onClose={() => setFormError('')}
        />
      )}

      {isSuperAdmin && (
        <Card className="rms-card" style={{ marginBottom: 20 }}>
          <Space>
            <span style={{ fontWeight: 600 }}>Target Customer Organization:</span>
            <Select
              aria-label="Select target customer"
              placeholder="Select Customer Organization"
              style={{ width: 320 }}
              value={org || undefined}
              onChange={setOrg}
              options={organizations.map(o => ({ value: o.id, label: o.name }))}
            />
          </Space>
        </Card>
      )}

      <Tabs
        type="card"
        items={[
          {
            key: 'manual',
            label: 'Manual Entry',
            children: (
              <Card className="rms-card" bordered={false}>
                <Typography.Paragraph type="secondary">
                  Add router identity details. Multiple tags can be created on-the-fly or selected from existing customer tags.
                </Typography.Paragraph>

                {manualRows.map((row, index) => (
                  <div
                    key={row.key}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      marginBottom: 12,
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ width: 24, color: '#94a3b8', fontWeight: 600 }}>
                      {index + 1}.
                    </span>

                    <Input
                      placeholder="Device Name (optional)"
                      value={row.name}
                      maxLength={128}
                      onChange={e => updateRow(row.key, 'name', e.target.value)}
                      style={{ width: 200 }}
                    />

                    <Input
                      placeholder="Serial Number *"
                      value={row.serial_number}
                      maxLength={63}
                      onChange={e => updateRow(row.key, 'serial_number', e.target.value)}
                      className="code-font"
                      style={{ width: 220 }}
                    />

                    <Input
                      placeholder="LAN MAC (AA:BB:CC:DD:EE:FF) *"
                      value={row.lan_mac}
                      maxLength={17}
                      onChange={e => updateRow(row.key, 'lan_mac', e.target.value)}
                      className="code-font"
                      style={{ width: 220 }}
                    />

                    <Select
                      mode="tags"
                      placeholder="Select or type tags"
                      value={row.tags}
                      onChange={v => updateRow(row.key, 'tags', v)}
                      options={tagOptions}
                      style={{ minWidth: 220, flex: 1 }}
                    />

                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeRow(row.key)}
                      disabled={manualRows.length === 1 && !row.serial_number && !row.lan_mac}
                    />
                  </div>
                ))}

                <Divider style={{ margin: '16px 0' }} />

                <Space>
                  <Button icon={<PlusOutlined />} onClick={addRow} disabled={submitting}>
                    Add Another Row
                  </Button>
                  <Button
                    type="primary"
                    onClick={handleManualSubmit}
                    loading={submitting}
                    disabled={!org}
                    style={{ background: '#0284c7', borderColor: '#0284c7' }}
                  >
                    Register Devices
                  </Button>
                </Space>
              </Card>
            ),
          },
          {
            key: 'csv',
            label: 'Batch CSV Import',
            children: (
              <Card className="rms-card" bordered={false}>
                <Typography.Paragraph>
                  Upload a standard CSV file to register up to 500 routers at once.
                </Typography.Paragraph>

                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <a
                    download="xnet-rms-devices-template.csv"
                    href={'data:text/csv;charset=utf-8,' + encodeURIComponent('name,serial_number,lan_mac,tags\nOffice Router,2S24090001,00:11:22:33:44:55,hq;branch\nWarehouse Router,2S24090002,AA:BB:CC:DD:EE:FF,warehouse\n')}
                  >
                    <Button icon={<DownloadOutlined />}>Download CSV Template</Button>
                  </a>

                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={!org || csvValidating}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) handleCsvUpload(file);
                        e.target.value = '';
                      }}
                    />
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                      Format: name,serial_number,lan_mac,tags (separate tags with semicolons). Maximum file size: 1 MiB.
                    </div>
                  </div>

                  {csvValidating && <div>Validating CSV rows against database...</div>}

                  {csvPreview.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <Typography.Title level={5} style={{ margin: 0 }}>
                          CSV Validation Preview ({csvPreview.filter(r => r.valid).length} valid / {csvPreview.length} total)
                        </Typography.Title>
                        <Button
                          type="primary"
                          loading={submitting}
                          disabled={!csvPreview.some(r => r.valid)}
                          onClick={handleCsvConfirm}
                          style={{ background: '#0284c7', borderColor: '#0284c7' }}
                        >
                          Confirm & Register Valid Rows
                        </Button>
                      </div>

                      <Table
                        size="small"
                        rowKey="row"
                        dataSource={csvPreview}
                        pagination={{ pageSize: 10 }}
                        columns={[
                          { title: 'Row', dataIndex: 'row', width: 70 },
                          { title: 'Name', render: (_, r) => r.data?.name || '—' },
                          { title: 'Serial Number', render: (_, r) => <span className="code-font">{r.data?.serial_number}</span> },
                          { title: 'LAN MAC', render: (_, r) => <span className="code-font">{r.data?.lan_mac}</span> },
                          {
                            title: 'Tags',
                            render: (_, r) => (
                              <Space wrap>
                                {r.data?.tags?.map((t: string) => (
                                  <Tag key={t}>{t}</Tag>
                                ))}
                              </Space>
                            ),
                          },
                          {
                            title: 'Status',
                            render: (_, r) =>
                              r.valid ? (
                                <Tag icon={<CheckCircleOutlined />} color="success">
                                  Valid
                                </Tag>
                              ) : (
                                <Tag icon={<CloseCircleOutlined />} color="error">
                                  {r.error || 'Invalid'}
                                </Tag>
                              ),
                          },
                        ]}
                      />
                    </div>
                  )}
                </Space>
              </Card>
            ),
          },
        ]}
      />

      {/* Submission Results Table */}
      {submissionResults.length > 0 && (
        <Card className="rms-card" title="Registration Result Report" style={{ marginTop: 20 }}>
          <Table
            size="small"
            rowKey="row"
            dataSource={submissionResults}
            columns={[
              { title: 'Row', dataIndex: 'row', width: 80 },
              {
                title: 'Result',
                render: (_, r) =>
                  r.success ? (
                    <Tag icon={<CheckCircleOutlined />} color="success">
                      Registered Successfully (ID: {r.id})
                    </Tag>
                  ) : (
                    <Tag icon={<CloseCircleOutlined />} color="error">
                      Failed: {r.error || 'Conflict or invalid data'}
                    </Tag>
                  ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
