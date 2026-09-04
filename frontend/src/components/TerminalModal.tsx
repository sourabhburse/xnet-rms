import React, { useEffect, useRef } from 'react';
import { Modal, Tag } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  open: boolean;
  token: string | null;
  deviceName: string;
  onClose: () => void;
}

export const TerminalModal: React.FC<Props> = ({ open, token, deviceName, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!open || !token || !terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#111827',
        foreground: '#f3f4f6',
        cursor: '#2e90fa',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    termInstance.current = term;

    term.writeln('\x1b[34m[NISEVA RMS]\x1b[0m Connecting to router shell via reverse tunnel...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/connect/terminal/${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln('\x1b[32m[CONNECTED]\x1b[0m Pseudo-terminal session established (/bin/ash)\n');
      term.focus();
    };

    ws.onmessage = (ev) => {
      term.write(ev.data);
    };

    ws.onclose = () => {
      term.writeln('\n\x1b[31m[DISCONNECTED]\x1b[0m Terminal session closed.');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    return () => {
      ws.close();
      term.dispose();
    };
  }, [open, token]);

  return (
    <Modal
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            <CodeOutlined style={{ color: '#2e90fa', marginRight: 8 }} />
            Web Terminal (/bin/ash) — {deviceName}
          </span>
          <Tag color="cyan">Interactive VT100 Shell</Tag>
        </div>
      }
      open={open}
      onCancel={onClose}
      width="85vw"
      style={{ top: 30 }}
      footer={null}
      bodyStyle={{ height: '70vh', padding: 12, backgroundColor: '#111827' }}
    >
      <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
    </Modal>
  );
};
