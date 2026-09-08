import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import './rms.css';

import { User } from './types';

interface LoginProps {
  onLoginSuccess: (user: User) => void;
  api: (path: string, method?: string, data?: unknown) => Promise<any>;
}

export default function Login({ onLoginSuccess, api }: LoginProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

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
      setError(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-body">
      <div className="auth-shell">
        <div className="auth-card">
          <img src="/logo.png" alt="XNET RMS" className="auth-logo" />
          <div className="auth-kicker">REMOTE MANAGEMENT SYSTEM</div>
          <h2 className="auth-title">Sign in to XNET RMS</h2>

          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              style={{ marginBottom: 16 }}
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
              rules={[
                { required: true, message: 'The Email field is required.' },
                { type: 'email', message: 'The Email field is not a valid e-mail address.' },
              ]}
              style={{ marginBottom: 14 }}
            >
              <Input
                className="auth-input-pill"
                placeholder="Email"
                autoFocus
                autoComplete="email"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'The Password field is required.' }]}
              style={{ marginBottom: 14 }}
            >
              <Input.Password
                className="auth-input-pill"
                placeholder="Password"
                autoComplete="current-password"
              />
            </Form.Item>

            <div style={{ marginBottom: 20 }}>
              <Checkbox
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="auth-checkbox"
              >
                Remember me
              </Checkbox>
            </div>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              className="auth-btn-pill"
              block
            >
              Login
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
