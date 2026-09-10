import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/globals.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<App />} />
        <Route path="/devices" element={<App />} />
        <Route path="/devices/:serial" element={<App />} />
        <Route path="/sessions" element={<App />} />
        <Route path="/reports" element={<App />} />
        <Route path="/admin/*" element={<App />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
