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
  kind?: 'gauge' | 'counter' | 'state' | 'text';
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
  health?: 'healthy' | 'warning' | 'critical';
  active_alerts?: number;
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
  health?: 'healthy' | 'warning' | 'critical';
  active_alerts?: number;
}

export interface ProfileField {
  id: string;
  path: string;
  label: string;
  unit?: string;
  kind: 'gauge' | 'counter' | 'state' | 'text';
  chart?: boolean;
  fleet?: boolean;
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
  organization_id?: string | null;
  definition: ProfileDefinition;
  created_at?: string;
}

export interface TelemetryAggregate {
  kind: string;
  label: string;
  unit?: string;
  count: number;
  sum?: number;
  min?: number;
  max?: number;
  average?: number;
  delta?: number;
  resets?: number;
  delta_samples?: number;
  state_seconds?: Record<string, number>;
  distinct?: string[];
  last: unknown;
}

export interface TelemetryReportPoint {
  device_id: string;
  device_name: string;
  source_id: string;
  bucket: string;
  fields: Record<string, TelemetryAggregate>;
}

export interface TelemetryReport {
  from: string;
  to: string;
  bucket?: 'hour' | 'day';
  resolution?: 'hour' | 'day';
  items: TelemetryReportPoint[];
  next_cursor?: string;
  alerts?: {
    count: number;
    warning_count: number;
    critical_count: number;
    warning_seconds: number;
    critical_seconds: number;
    first_breach?: string | null;
    last_breach?: string | null;
    current_state: 'healthy' | 'warning' | 'critical';
  };
}

export interface CatalogMetric {
  id: string;
  category: string;
  description: string;
  source_id: string;
  required_capability?: string;
  field: ProfileField;
}

export interface MonitoringCatalog {
  version: number;
  categories: string[];
  metrics: CatalogMetric[];
}

export interface ThresholdCondition {
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'outside';
  value?: number;
  minimum?: number;
  maximum?: number;
}

export interface MonitoringMetricSelection {
  metric_id: string;
  label?: string;
  description?: string;
  threshold?: {
    warning?: ThresholdCondition;
    critical?: ThresholdCondition;
    states?: Record<string, 'healthy' | 'warning' | 'critical'>;
  };
}

export interface MonitoringTemplateDefinition {
  catalog_version: number;
  interval_seconds: number;
  metrics: MonitoringMetricSelection[];
  stale: { enabled: boolean; severity?: 'warning' | 'critical'; missed_intervals?: number };
}

export interface MonitoringTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  version: number;
  definition: MonitoringTemplateDefinition;
}

export interface MonitoringBinding {
  id: string;
  organization_id: string;
  template_id: string;
  template_name: string;
  template_version: number;
  target_type: 'device' | 'group' | 'tag';
  target_id: string;
  interval_seconds?: number;
  enabled: boolean;
}

export interface AlertItem {
  id: string;
  organization_id: string;
  device_id: string;
  device_name: string;
  template_id: string;
  template_name: string;
  template_version: number;
  metric_id: string;
  entity_key: string;
  severity: 'warning' | 'critical';
  status: 'PENDING' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  last_value: unknown;
  opened_at?: string;
  acknowledged_at?: string;
  resolved_at?: string;
  resolution_reason?: string;
  updated_at: string;
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
  user_id: string | null;
  action: string;
  resource_id: string;
  created_at: string;
}

export interface CollectorBundle {
  id: string;
  version: number;
  script: string;
  created_at?: string;
}
