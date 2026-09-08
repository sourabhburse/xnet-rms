export type Role = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'OPERATOR' | 'VIEWER';

export interface User {
  id: string;
  organization_id: string;
  email: string;
  role: Role;
  disabled?: boolean;
}

export interface Organization {
  id: string;
  name: string;
}

export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'REVOKED';

export interface SnapshotField {
  label: string;
  value: unknown;
  unit?: string;
  kind?: 'gauge' | 'counter' | 'text';
}

export interface SnapshotSource {
  source_id: string;
  fields: Record<string, SnapshotField>;
  status: 'ok' | 'error' | string;
  received_at: string;
  observed_at: string;
  stale: boolean;
  definition?: ProfileDefinition;
  data?: Record<string, unknown>;
  dropped?: number;
  error?: string;
}

export interface Device {
  id: string;
  organization_id: string;
  name: string;
  lan_mac: string;
  tags: string[];
  groups?: string[];
  serial_number: string;
  model: string;
  firmware_version: string;
  revoked: boolean;
  last_seen: string;
  status: DeviceStatus;
  sources?: SnapshotSource[];
}

export interface Registration {
  id: string;
  organization_id: string;
  serial_number: string;
  lan_mac: string;
  name: string;
  tags: string[];
  device_id: string | null;
  canceled: boolean;
  created_at: string;
  status: 'awaiting_device' | 'claimed' | 'canceled';
}

export interface PendingDevice {
  id: string;
  organization_id: string;
  serial_number: string;
  lan_mac: string;
  model: string;
  last_seen: string;
}

export interface TagItem {
  id: string;
  organization_id: string;
  name: string;
}

export interface DeviceGroup {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  created_at?: string;
  device_count: number;
}

export interface ProfileField {
  id: string;
  path: string;
  label: string;
  unit?: string;
  kind: 'gauge' | 'counter' | 'text';
}

export interface ProfileDefinition {
  name: string;
  source_id: string;
  type: string;
  object?: string;
  method?: string;
  interval_seconds: number;
  timeout_seconds?: number;
  max_output_bytes?: number;
  fields: ProfileField[];
}

export interface Profile {
  id: string;
  version: number;
  definition: ProfileDefinition;
  created_at?: string;
}

export interface SessionItem {
  id: string;
  device_id: string;
  user_id: string;
  protocol: 'SSH_LUCI' | 'TERMINAL_SSH' | 'HTTP_LUCI' | string;
  expires_at: string;
  closed_at: string | null;
}

export interface DashboardStats {
  total: number;
  online: number;
  offline: number;
  revoked: number;
}

export interface EnrollmentToken {
  id: string;
  organization_id: string;
  name: string;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  revoked: boolean;
  group_ids?: string[];
}

export interface AuditRecord {
  id: string;
  organization_id: string;
  actor_id: string;
  action: string;
  target_id: string;
  created_at: string;
}

export interface CollectorBundle {
  id: string;
  version: number;
  script: string;
  created_at?: string;
}
