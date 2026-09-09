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
  const cards = [
    {
      key: 'online',
      title: 'Online now',
      value: stats.online ?? 0,
      caption: 'Enrolled devices',
      status: 'status-online',
      label: 'Filter online devices',
      onClick: () => {
        onSelectFilter?.('ONLINE');
        onNavigate?.('devices');
      },
    },
    {
      key: 'offline',
      title: 'Offline',
      value: stats.offline ?? 0,
      caption: 'Needs attention',
      status: 'status-offline',
      label: 'Filter offline devices',
      onClick: () => {
        onSelectFilter?.('OFFLINE');
        onNavigate?.('devices');
      },
    },
    {
      key: 'awaiting',
      title: 'Awaiting device',
      value: awaitingCount,
      caption: 'Pre-registered',
      status: 'status-awaiting',
      label: 'Open awaiting devices',
      onClick: () => onNavigate?.('registration-requests'),
    },
    {
      key: 'pending',
      title: 'Available to claim',
      value: pendingCount,
      caption: 'Ready for ownership',
      status: 'status-pending',
      label: 'Open available devices',
      onClick: () => onNavigate?.('available-to-claim'),
    },
    {
      key: 'revoked',
      title: 'Revoked',
      value: stats.revoked ?? 0,
      caption: 'Access disabled',
      status: 'status-revoked',
      label: 'Filter revoked devices',
      onClick: () => {
        onSelectFilter?.('REVOKED');
        onNavigate?.('devices');
      },
    },
  ];

  return (
    <div className="stats-grid">
      {cards.map(card => (
        <button
          key={card.key}
          type="button"
          className="stat-card"
          onClick={card.onClick}
          aria-label={card.label}
        >
          <span className="stat-card-topline">
            <span className="stat-card-title">{card.title}</span>
            <span className={`stat-card-dot ${card.status}`} aria-hidden="true" />
          </span>
          <span className="stat-card-value">{card.value}</span>
          <span className="stat-card-caption">{card.caption}</span>
        </button>
      ))}
    </div>
  );
}
