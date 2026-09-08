import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3978e8',
          colorInfo: '#3978e8',
          colorSuccess: '#22a761',
          colorWarning: '#d88b22',
          colorError: '#d14b5b',
          colorBgBase: '#20242b',
          colorBgContainer: '#282e37',
          colorBgLayout: '#20242b',
          colorBorder: '#3b4553',
          colorText: '#edf2f8',
          colorTextSecondary: '#a5b0c0',
          borderRadius: 8,
          fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        components: {
          Table: {
            headerBg: '#303741',
            headerColor: '#aab6c7',
            rowHoverBg: '#303946',
            borderColor: '#3b4553',
          },
          Card: {
            headerBg: '#ffffff',
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
