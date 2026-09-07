import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
type Row = Record<string, any>;
type Entry = { name: string; serial_number: string; lan_mac: string; tags: string[] };
const blank = (): Entry => ({ name: '', serial_number: '', lan_mac: '', tags: [] });
async function request(path: string, method = 'GET', value?: unknown, csv = false) {
  const r = await fetch('/api/v1/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': csv ? 'text/csv' : 'application/json' }, body: value === undefined ? undefined : csv ? String(value) : JSON.stringify(value) });
  if (r.status === 204) return null;
  const b = await r.json(); if (!r.ok) throw new Error(b.error || 'Request failed'); return b;
}
export default function Onboarding({ user }: { user: Row }) {
  const [org, setOrg] = useState(user.organization_id || ''), [orgs, setOrgs] = useState<Row[]>([]);
  const [rows, setRows] = useState<Entry[]>([blank()]), [pending, setPending] = useState<Row[]>([]), [registrations, setRegistrations] = useState<Row[]>([]), [tags, setTags] = useState<Row[]>([]);
  const [preview, setPreview] = useState<Row[]>([]), [results, setResults] = useState<Row[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null), [editName, setEditName] = useState(''), [editTags, setEditTags] = useState<string[]>([]);
  const refresh = async () => { const [p, r, t] = await Promise.all([request('pending-devices'), request('registrations'), request('tags')]); setPending(p); setRegistrations(r); setTags(t); };
  useEffect(() => { refresh().catch(e => setError(String(e))); if (user.role === 'SUPER_ADMIN') request('organizations').then(setOrgs).catch(e => setError(String(e))); const timer = setInterval(() => refresh().catch(e => setError(String(e))), 15000); return () => clearInterval(timer); }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const submit = (entries: Entry[]) => run(async () => { const response = await request('registrations', 'POST', { organization_id: org, rows: entries }); setResults(response); setRows(entries.filter((_, i) => !response[i]?.success)); setPreview([]); await refresh(); });
  const options = tags.filter(t => t.organization_id === org).map(t => ({ label: t.name, value: t.name }));
  const identityColumns = [{ title: 'Serial number', dataIndex: 'serial_number' }, { title: 'LAN MAC', dataIndex: 'lan_mac' }];
  const startEdit = (row: Row, claim: boolean) => { setEditing({ ...row, claim }); setEditName(row.name || ''); setEditTags(row.tags || []); };
  return <Space direction="vertical" style={{ width: '100%' }} size="large">
    <Typography.Paragraph>Add devices by serial number and LAN MAC, or claim routers associated with your organization's enrollment token. No router password is required.</Typography.Paragraph>
    {error && <Alert type="error" message={error} />}
    {user.role === 'SUPER_ADMIN' && <Select aria-label="Customer" placeholder="Select customer" style={{ width: 320 }} value={org || undefined} onChange={v => { setOrg(v); setPreview([]); setResults([]); }} options={orgs.map(o => ({ value: o.id, label: o.name }))} />}
    <Tabs items={[
      { key: 'manual', label: 'Manual', children: <Space direction="vertical" style={{ width: '100%' }}>
        {rows.map((row, index) => <Space wrap key={index}><Input aria-label={`Name ${index + 1}`} placeholder="Name (optional)" maxLength={128} value={row.name} onChange={e => setRows(rows.map((v, i) => i === index ? { ...v, name: e.target.value } : v))} /><Input aria-label={`Serial ${index + 1}`} placeholder="Serial number" maxLength={63} value={row.serial_number} onChange={e => setRows(rows.map((v, i) => i === index ? { ...v, serial_number: e.target.value } : v))} /><Input aria-label={`LAN MAC ${index + 1}`} placeholder="AA:BB:CC:DD:EE:FF" value={row.lan_mac} onChange={e => setRows(rows.map((v, i) => i === index ? { ...v, lan_mac: e.target.value } : v))} /><Select aria-label={`Tags ${index + 1}`} mode="tags" placeholder="Tags" style={{ minWidth: 220 }} options={options} value={row.tags} onChange={v => setRows(rows.map((r, i) => i === index ? { ...r, tags: v } : r))} /><Button disabled={busy} onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</Button></Space>)}
        <Space><Button disabled={rows.length >= 500 || busy} onClick={() => setRows([...rows, blank()])}>Add row</Button><Button type="primary" loading={busy} disabled={!org || !rows.length} onClick={() => submit(rows)}>Register devices</Button></Space>
      </Space> },
      { key: 'csv', label: 'From file', children: <Space direction="vertical" style={{ width: '100%' }}>
        <a download="rms-devices.csv" href={'data:text/csv;charset=utf-8,' + encodeURIComponent('name,serial_number,lan_mac,tags\n')}>Download CSV template</a>
        <Typography.Text>Maximum 500 rows / 1 MiB. Separate tags with semicolons. Preview first, then confirm valid rows.</Typography.Text>
        <input aria-label="Device CSV" type="file" accept=".csv,text/csv" disabled={!org || busy} onChange={e => { const file = e.target.files?.[0]; setPreview([]); if (file) run(async () => { if (file.size > 1048576) throw new Error('Maximum file size is 1 MiB'); setPreview(await request('registrations/preview?organization_id=' + encodeURIComponent(org), 'POST', await file.text(), true)); }); e.target.value = ''; }} />
        <Table rowKey="row" dataSource={preview} columns={[{ title: 'Row', dataIndex: 'row' }, { title: 'Serial', render: (_, r) => r.data.serial_number }, { title: 'LAN MAC', render: (_, r) => r.data.lan_mac }, { title: 'Result', render: (_, r) => r.valid ? 'Valid' : r.error }]} />
        <Button type="primary" loading={busy} disabled={!preview.some(r => r.valid)} onClick={() => submit(preview.filter(r => r.valid).map(r => r.data))}>Confirm valid rows</Button>
      </Space> },
      { key: 'pending', label: 'Available to claim', children: <Table rowKey="id" dataSource={pending.filter(p => !org || p.organization_id === org)} columns={[...identityColumns, { title: 'Model', dataIndex: 'model' }, { title: 'Action', render: (_, r) => <Button onClick={() => startEdit(r, true)}>Claim</Button> }]} /> },
      { key: 'registrations', label: 'Registration requests', children: <Table rowKey="id" dataSource={registrations.filter(r => !org || r.organization_id === org)} columns={[{ title: 'Name', dataIndex: 'name' }, ...identityColumns, { title: 'Tags', render: (_, r) => r.tags?.map((t: string) => <Tag key={t}>{t}</Tag>) }, { title: 'State', render: (_, r) => r.status === 'awaiting_device' ? 'Awaiting device' : r.status }, { title: 'Actions', render: (_, r) => r.status === 'awaiting_device' && <Space><Button onClick={() => startEdit(r, false)}>Edit</Button><Button danger onClick={() => Modal.confirm({ title: 'Cancel this registration?', onOk: () => run(async () => { await request('registrations/' + r.id, 'DELETE'); await refresh(); }) })}>Cancel</Button></Space> }]} /> }
    ]} />
    {!!results.length && <Table rowKey="row" dataSource={results} columns={[{ title: 'Submitted row', dataIndex: 'row' }, { title: 'Result', render: (_, r) => r.success ? 'Registered' : r.error }]} />}
    <Modal title={editing?.claim ? 'Claim router' : 'Edit registration'} open={!!editing} confirmLoading={busy} onCancel={() => setEditing(null)} onOk={() => run(async () => { await request(editing?.claim ? `pending-devices/${editing.id}/claim` : `registrations/${editing?.id}`, editing?.claim ? 'POST' : 'PATCH', { name: editName, tags: editTags }); setEditing(null); await refresh(); })}>
      <Space direction="vertical" style={{ width: '100%' }}><Input aria-label="Device name" placeholder="Name (optional)" value={editName} onChange={e => setEditName(e.target.value)} /><Select aria-label="Device tags" style={{ width: '100%' }} mode="tags" value={editTags} options={tags.filter(t => t.organization_id === editing?.organization_id).map(t => ({ label: t.name, value: t.name }))} onChange={setEditTags} /></Space>
    </Modal>
  </Space>;
}
