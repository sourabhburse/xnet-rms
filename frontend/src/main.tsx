import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3f3f3f',
          colorInfo: '#3f3f3f',
          colorSuccess: '#3f3f3f',
          colorWarning: '#3f3f3f',
          colorError: '#3f3f3f',
          colorBgBase: '#ffffff',
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f3f3f3',
          colorBorder: '#d7d7d7',
          colorText: '#252525',
          colorTextSecondary: '#696969',
          borderRadius: 2,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        },
        components: {
          Table: {
            headerBg: '#f1f1f1',
            headerColor: '#3f3f3f',
            rowHoverBg: '#f6f6f6',
            borderColor: '#d7d7d7',
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
