import React, { useEffect, useState } from 'react';
import { Button, Card, Empty, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SettingOutlined } from '@ant-design/icons';
import { Device, DeviceGroup, Organization, User } from '../types';
import { api, formatApiError } from '../api';

interface Props {
  user: User;
  organizations: Organization[];
  selectedOrg: string;
  groups: DeviceGroup[];
  devices: Device[];
  onRefresh: () => void;
}

export default function GroupsManager({ user, organizations, selectedOrg, groups, devices, onRefresh }: Props) {
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const canEdit = isSuperAdmin || user.role === 'ORG_ADMIN';
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceGroup | null>(null);
  const [managing, setManaging] = useState<DeviceGroup | null>(null);
  const [targetOrg, setTargetOrg] = useState(selectedOrg || user.organization_id || '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (selectedOrg) setTargetOrg(selectedOrg); }, [selectedOrg]);

  const visibleGroups = groups.filter(g => !targetOrg || g.organization_id === targetOrg);
  const visibleDevices = devices.filter(d => !targetOrg || d.organization_id === targetOrg);

  const openCreate = () => {
    setEditing(null); setName(''); setDescription(''); setModalOpen(true);
  };
  const openEdit = (group: DeviceGroup) => {
    setEditing(group); setName(group.name); setDescription(group.description || ''); setModalOpen(true);
  };
  const save = async () => {
    if (!name.trim() || (isSuperAdmin && !targetOrg)) { message.warning('Organization and group name are required.'); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), organization_id: targetOrg };
      if (editing) await api(`groups/${editing.id}`, 'PATCH', payload);
      else await api('groups', 'POST', payload);
      message.success(editing ? 'Group updated' : 'Group created');
      setModalOpen(false); onRefresh();
    } catch (e) { message.error(formatApiError(e).message); }
    finally { setBusy(false); }
  };
  const remove = (group: DeviceGroup) => Modal.confirm({
    title: `Delete ${group.name}?`,
    content: 'Devices remain enrolled; only their membership in this group is removed.',
    okType: 'danger',
    onOk: async () => { try { await api(`groups/${group.id}`, 'DELETE'); message.success('Group deleted'); onRefresh(); } catch (e) { message.error(formatApiError(e).message); } },
  });
  const openManage = async (group: DeviceGroup) => {
    setManaging(group); setBusy(true);
    try {
      const members = await api<Device[]>(`groups/${group.id}/devices`);
      setSelectedDevices((members || []).map(d => d.id));
    } catch (e) { message.error(formatApiError(e).message); }
    finally { setBusy(false); }
  };
  const updateMembers = async (ids: string[]) => {
    if (!managing) return;
    const before = new Set(selectedDevices); const after = new Set(ids);
    setSelectedDevices(ids); setBusy(true);
    try {
      await Promise.all([
        ...ids.filter(id => !before.has(id)).map(id => api(`groups/${managing.id}/devices/${id}`, 'PUT')),
        ...selectedDevices.filter(id => !after.has(id)).map(id => api(`groups/${managing.id}/devices/${id}`, 'DELETE')),
      ]);
      message.success('Group membership updated'); onRefresh();
    } catch (e) { message.error(formatApiError(e).message); }
    finally { setBusy(false); }
  };

  return <Card title="Device groups" extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Create group</Button>}>
    {isSuperAdmin && <Select aria-label="Organization" value={targetOrg || undefined} placeholder="Select organization" options={organizations.map(o => ({ value: o.id, label: o.name }))} onChange={setTargetOrg} style={{ width: 260, marginBottom: 16 }} />}
    {visibleGroups.length === 0 ? <Empty description="No groups for this organization" /> : <Table rowKey="id" dataSource={visibleGroups} pagination={false} columns={[
      { title: 'Name', dataIndex: 'name', render: (v: string) => <strong>{v}</strong> },
      { title: 'Description', dataIndex: 'description', render: (v: string) => v || '—' },
      { title: 'Devices', dataIndex: 'device_count', render: (v: number) => <Tag>{v}</Tag> },
      ...(canEdit ? [{ title: 'Actions', render: (_: unknown, row: DeviceGroup) => <Space><Button icon={<SettingOutlined />} onClick={() => openManage(row)}>Manage devices</Button><Button icon={<EditOutlined />} onClick={() => openEdit(row)} /><Button danger icon={<DeleteOutlined />} onClick={() => remove(row)} /></Space> }] : []),
    ] as any} />}
    <Modal title={editing ? 'Edit device group' : 'Create device group'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={save} confirmLoading={busy}>
      {isSuperAdmin && <Select aria-label="Target organization" value={targetOrg || undefined} placeholder="Target organization" options={organizations.map(o => ({ value: o.id, label: o.name }))} onChange={setTargetOrg} style={{ width: '100%', marginBottom: 12 }} />}
      <Form layout="vertical"><Form.Item label="Name" required><Input value={name} maxLength={128} onChange={e => setName(e.target.value)} /></Form.Item><Form.Item label="Description"><Input.TextArea value={description} maxLength={512} onChange={e => setDescription(e.target.value)} /></Form.Item></Form>
    </Modal>
    <Modal title={managing ? `Devices in ${managing.name}` : 'Manage devices'} open={!!managing} onCancel={() => setManaging(null)} footer={null}>
      <Select mode="multiple" showSearch optionFilterProp="label" value={selectedDevices} onChange={updateMembers} loading={busy} style={{ width: '100%' }} options={visibleDevices.map(d => ({ value: d.id, label: `${d.name || d.serial_number} · ${d.serial_number}` }))} placeholder="Select devices" />
    </Modal>
  </Card>;
}
