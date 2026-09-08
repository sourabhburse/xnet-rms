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
          colorBgBase: '#ffffff',
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f6f8fc',
          colorBorder: '#e4e9f1',
          colorText: '#172238',
          colorTextSecondary: '#718096',
          borderRadius: 8,
          fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        components: {
          Table: {
            headerBg: '#f8fafc',
            headerColor: '#738198',
            rowHoverBg: '#f7faff',
            borderColor: '#e4e9f1',
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
