import React from 'react';
import { DashboardStats } from '../types';

interface StatsBarProps {
  stats: DashboardStats;
  pendingCount: number;
  awaitingCount: number;
  onSelectFilter?: (status: string) => void;
  onNavigate?: (view: string) => void;
}

export default function StatsBar({
  stats,
  pendingCount,
  awaitingCount,
  onSelectFilter,
  onNavigate,
}: StatsBarProps) {
  return (
    <div className="stats-grid">
      <div
        className="stat-card"
        style={{ borderTop: '3px solid #10b981' }}
        onClick={() => {
          onSelectFilter?.('ONLINE');
          onNavigate?.('devices');
        }}
      >
        <div className="stat-card-title">Enrolled Online</div>
        <div className="stat-card-value" style={{ color: '#059669' }}>
          {stats.online ?? 0}
          <span className="status-pill status-online" style={{ fontSize: 11, padding: '1px 8px' }}>
            <span className="status-dot" /> Online
          </span>
        </div>
      </div>

      <div
        className="stat-card"
        style={{ borderTop: '3px solid #94a3b8' }}
        onClick={() => {
          onSelectFilter?.('OFFLINE');
          onNavigate?.('devices');
        }}
      >
        <div className="stat-card-title">Enrolled Offline</div>
        <div className="stat-card-value" style={{ color: '#475569' }}>
          {stats.offline ?? 0}
          <span className="status-pill status-offline" style={{ fontSize: 11, padding: '1px 8px' }}>
            <span className="status-dot" /> Offline
          </span>
        </div>
      </div>

      <div
        className="stat-card"
        style={{ borderTop: '3px solid #f59e0b' }}
        onClick={() => onNavigate?.('registration-requests')}
      >
        <div className="stat-card-title">Awaiting Device</div>
        <div className="stat-card-value" style={{ color: '#d97706' }}>
          {awaitingCount}
          <span className="status-pill status-awaiting" style={{ fontSize: 11, padding: '1px 8px' }}>
            <span className="status-dot" /> Pre-registered
          </span>
        </div>
      </div>

      <div
        className="stat-card"
        style={{ borderTop: '3px solid #8b5cf6' }}
        onClick={() => onNavigate?.('available-to-claim')}
      >
        <div className="stat-card-title">Available to Claim</div>
        <div className="stat-card-value" style={{ color: '#7c3aed' }}>
          {pendingCount}
          <span className="status-pill status-pending" style={{ fontSize: 11, padding: '1px 8px' }}>
            <span className="status-dot" /> Pending
          </span>
        </div>
      </div>

      <div
        className="stat-card"
        style={{ borderTop: '3px solid #ef4444' }}
        onClick={() => {
          onSelectFilter?.('REVOKED');
          onNavigate?.('devices');
        }}
      >
        <div className="stat-card-title">Revoked</div>
        <div className="stat-card-value" style={{ color: '#dc2626' }}>
          {stats.revoked ?? 0}
          <span className="status-pill status-revoked" style={{ fontSize: 11, padding: '1px 8px' }}>
            <span className="status-dot" /> Revoked
          </span>
        </div>
      </div>
    </div>
  );
}
