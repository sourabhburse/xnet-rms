import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { formatApiError } from './api';
import './rms.css';

import { User } from './types';

interface LoginProps {
  onLoginSuccess: (user: User) => void;
  api: (path: string, method?: string, data?: unknown) => Promise<any>;
}

export default function Login({ onLoginSuccess, api }: LoginProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(
    () => localStorage.getItem('xnet_remember_email') !== null
  );

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      const result = await api('auth/login', 'POST', values);
      if (rememberMe) {
        localStorage.setItem('xnet_remember_email', values.email);
      } else {
        localStorage.removeItem('xnet_remember_email');
      }
      onLoginSuccess(result.user);
    } catch (e: any) {
      const formatted = formatApiError(e);
      setError(formatted.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-split-container">
      {/* Left Showcase Pane - Pure Enterprise Branding */}
      <div className="login-showcase">
        <div className="showcase-brand-center">
          <div className="showcase-brand-glow" />
          <img src="/logo.png" alt="XNET RMS" className="showcase-hero-logo" />
          <div className="showcase-brand-title-wrap">
            <span className="showcase-hero-title">XNET RMS</span>
            <span className="showcase-badge">Enterprise</span>
          </div>
          <div className="showcase-hero-subtitle">
            Remote Management System
          </div>
        </div>
      </div>

      {/* Right Authentication Pane */}
      <div className="login-auth">
        <div className="auth-form-container">
          {/* Mobile brand header (shown < 1024px) */}
          <div className="auth-mobile-header">
            <img src="/logo.png" alt="XNET RMS" className="auth-mobile-logo" />
            <div className="auth-mobile-brand">
              <span>XNET RMS</span>
              <span className="showcase-badge">Enterprise</span>
            </div>
          </div>

          <h2 className="auth-heading">Welcome back</h2>
          <p className="auth-subheading">Sign in to manage your router fleet</p>

          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              style={{ marginBottom: 20, borderRadius: 8 }}
            />
          )}

          <Form
            layout="vertical"
            requiredMark={false}
            onFinish={onFinish}
            initialValues={{
              email: localStorage.getItem('xnet_remember_email') || '',
            }}
          >
            <Form.Item
              name="email"
              label={<span style={{ fontWeight: 500, fontSize: 13, color: '#334155' }}>Email Address</span>}
              rules={[
                { required: true, message: 'Please enter your email address' },
                { type: 'email', message: 'Please enter a valid email address' },
              ]}
              style={{ marginBottom: 18 }}
            >
              <Input
                prefix={<MailOutlined className="auth-input-icon" />}
                className="auth-input-modern"
                placeholder="admin@example.com"
                autoFocus
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={<span style={{ fontWeight: 500, fontSize: 13, color: '#334155' }}>Password</span>}
              rules={[{ required: true, message: 'Please enter your password' }]}
              style={{ marginBottom: 18 }}
            >
              <Input.Password
                prefix={<LockOutlined className="auth-input-icon" />}
                className="auth-input-modern"
                placeholder="••••••••••••"
                autoComplete="current-password"
              />
            </Form.Item>

            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Checkbox
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="auth-checkbox-modern"
              >
                Remember me
              </Checkbox>
            </div>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              className="auth-btn-modern"
              block
            >
              Sign in
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
