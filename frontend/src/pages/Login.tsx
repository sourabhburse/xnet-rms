import React, { useState } from 'react';
import { Card, Form, Input, Button, Typography, Space, Tag, message } from 'antd';
import { LockOutlined, MailOutlined, SafetyCertificateOutlined } from '@ant-design/icons';

import { login } from '../services/api';

const { Title, Text } = Typography;

interface Props {
  onLoginSuccess: (user: any) => void;
}

export const Login: React.FC<Props> = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);

  const handleLogin = async (values: any) => {
    setLoading(true);
    try {
      const data = await login(values.email, values.password);
      const user = {
        id: data.user?.id,
        email: data.user?.email || values.email,
        name: data.user?.first_name ? `${data.user.first_name} ${data.user.last_name || ''}`.trim() : values.email.split('@')[0],
        role: data.user?.role || 'SUPER_ADMIN',
        organization: 'Niseva Global Management',
      };

      localStorage.setItem('xnet_rms_user', JSON.stringify(user));
      localStorage.setItem('niseva_user', JSON.stringify(user));
      if (data.token) {
        localStorage.setItem('niseva_token', data.token);
        localStorage.setItem('token', data.token);
      }
      message.success(`Welcome back, ${user.name}!`);
      onLoginSuccess(user);
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (email: string, pass: string) => {
    const form = document.querySelector('form');
    if (form) {
      const emailInput = form.querySelector('#login_email') as HTMLInputElement;
      const passInput = form.querySelector('#login_password') as HTMLInputElement;
      if (emailInput && passInput) {
        emailInput.value = email;
        passInput.value = pass;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
      }}
    >
      <Card
        bordered={false}
        style={{
          width: 440,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
          borderRadius: 12,
          backgroundColor: '#ffffff',
        }}
        bodyStyle={{ padding: '36px 32px' }}
      >
        {/* Header Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src="/logo.png"
            alt="XNET Logo"
            style={{ height: 44, objectFit: 'contain', marginBottom: 8 }}
          />
          <div>
            <span style={{ color: '#2e90fa', fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>
              CLOUD RMS
            </span>
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Enterprise Fleet Management & Remote Control
          </Text>
        </div>

        {/* Login Form */}
        <Form name="login" layout="vertical" onFinish={handleLogin} requiredMark={false}>
          <Form.Item
            name="email"
            label={<span style={{ fontWeight: 500, color: '#374151' }}>Email Address</span>}
            rules={[{ required: true, message: 'Please enter your email' }]}
            initialValue="admin@niseva.com"
          >
            <Input
              id="login_email"
              prefix={<MailOutlined style={{ color: '#9ca3af' }} />}
              placeholder="user@company.com"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span style={{ fontWeight: 500, color: '#374151' }}>Password</span>}
            rules={[{ required: true, message: 'Please enter your password' }]}
            initialValue="Admin@12345"
          >
            <Input.Password
              id="login_password"
              prefix={<LockOutlined style={{ color: '#9ca3af' }} />}
              placeholder="Enter your password"
              size="large"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={loading}
            block
            style={{
              backgroundColor: '#2e90fa',
              borderColor: '#2e90fa',
              fontWeight: 600,
              height: 44,
              marginTop: 8,
            }}
          >
            Sign In to Console
          </Button>
        </Form>

        {/* Quick Fill Helpers for Testing */}
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, textAlign: 'center' }}>
            QUICK LOGIN DEMO ACCOUNTS:
          </div>
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            <div
              onClick={() => quickFill('admin@niseva.com', 'Admin@12345')}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderRadius: 6,
                backgroundColor: '#f8fafc',
                cursor: 'pointer',
                fontSize: 12,
                border: '1px solid #e2e8f0',
              }}
            >
              <span><strong>Superadmin:</strong> admin@niseva.com</span>
              <Tag color="blue">Global Platform</Tag>
            </div>

            <div
              onClick={() => quickFill('admin@acmesolar.com', 'Acme@12345')}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderRadius: 6,
                backgroundColor: '#f8fafc',
                cursor: 'pointer',
                fontSize: 12,
                border: '1px solid #e2e8f0',
              }}
            >
              <span><strong>Tenant Admin:</strong> admin@acmesolar.com</span>
              <Tag color="green">Acme Solar</Tag>
            </div>
          </Space>
        </div>

        {/* Footer Security Badge */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Space size={4}>
            <SafetyCertificateOutlined style={{ color: '#10b981' }} />
            <span style={{ fontSize: 11, color: '#64748b' }}>
              End-to-End Encrypted • Hardware Token Protected
            </span>
          </Space>
        </div>
      </Card>
    </div>
  );
};
