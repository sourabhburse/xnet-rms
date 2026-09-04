import React, { useState, useEffect } from 'react';
import { Modal, Button, Tag, Space } from 'antd';
import { GlobalOutlined, ClockCircleOutlined, ReloadOutlined } from '@ant-design/icons';

interface Props {
  open: boolean;
  token: string | null;
  deviceName: string;
  onClose: () => void;
}

export const LuciModal: React.FC<Props> = ({ open, token, deviceName, onClose }) => {
  const [secondsLeft, setSecondsLeft] = useState(900); // 15 minutes

  useEffect(() => {
    if (!open) return;
    setSecondsLeft(900);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [open]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleExtend = () => {
    setSecondsLeft((prev) => prev + 900);
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 32 }}>
          <span>
            <GlobalOutlined style={{ color: '#2e90fa', marginRight: 8 }} />
            Remote LuCI WebUI — {deviceName}
          </span>
          <Space>
            <Tag icon={<ClockCircleOutlined />} color={secondsLeft < 180 ? 'error' : 'processing'}>
              Session: {formatTime(secondsLeft)} remaining
            </Tag>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleExtend}>
              +15m
            </Button>
          </Space>
        </div>
      }
      open={open}
      onCancel={onClose}
      width="90vw"
      style={{ top: 20 }}
      footer={null}
      bodyStyle={{ height: '80vh', padding: 0 }}
    >
      {token ? (
        <iframe
          src={`/connect/luci/${token}/cgi-bin/luci`}
          style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
          title="LuCI Viewer"
        />
      ) : (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
          Initializing reverse tunnel connection...
        </div>
      )}
    </Modal>
  );
};
