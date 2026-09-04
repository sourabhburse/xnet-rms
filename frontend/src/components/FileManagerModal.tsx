import React from 'react';
import { Modal, Table, Button, Space, Tag } from 'antd';
import { FolderOutlined, FileTextOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons';

interface Props {
  open: boolean;
  deviceName: string;
  onClose: () => void;
}

export const FileManagerModal: React.FC<Props> = ({ open, deviceName, onClose }) => {
  const dummyFiles = [
    { key: '1', name: '..', size: '--', type: 'dir', modified: '2026-09-02 22:00' },
    { key: '2', name: 'network', size: '1.8 KB', type: 'file', modified: '2026-09-02 22:15' },
    { key: '3', name: 'wireless', size: '840 B', type: 'file', modified: '2026-09-02 22:10' },
    { key: '4', name: 'firewall', size: '3.2 KB', type: 'file', modified: '2026-09-02 22:12' },
    { key: '5', name: 'niseva', size: '450 B', type: 'file', modified: '2026-09-02 22:18' },
  ];

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: any) => (
        <Space>
          {record.type === 'dir' ? (
            <FolderOutlined style={{ color: '#2e90fa' }} />
          ) : (
            <FileTextOutlined style={{ color: '#9ca3af' }} />
          )}
          <span>{text}</span>
        </Space>
      ),
    },
    { title: 'Size', dataIndex: 'size', key: 'size' },
    { title: 'Modified', dataIndex: 'modified', key: 'modified' },
    {
      title: 'Action',
      key: 'action',
      render: (_: any, record: any) =>
        record.type === 'file' ? (
          <Space>
            <Button size="small" icon={<DownloadOutlined />}>
              Download
            </Button>
            <Button size="small">Edit</Button>
          </Space>
        ) : null,
    },
  ];

  return (
    <Modal
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            <FolderOutlined style={{ color: '#2e90fa', marginRight: 8 }} />
            File Explorer (SFTP /etc/config/) — {deviceName}
          </span>
          <Tag color="blue">Flash Space: 3.2 MB free</Tag>
        </div>
      }
      open={open}
      onCancel={onClose}
      width="70vw"
      footer={[
        <Button key="upload" icon={<UploadOutlined />}>
          Upload File
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          Close
        </Button>,
      ]}
    >
      <Table dataSource={dummyFiles} columns={columns} pagination={false} size="small" />
    </Modal>
  );
};
