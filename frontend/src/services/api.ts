import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('niseva_token') || localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('niseva_token');
      localStorage.removeItem('token');
      localStorage.removeItem('xnet_rms_user');
      localStorage.removeItem('niseva_user');
    }
    return Promise.reject(err);
  }
);

export interface Device {
  id: string;
  serial_number: string;
  mac_address: string;
  model: string;
  hardware_model?: string;
  name: string;
  imei?: string;
  firmware_version?: string;
  status: 'ONLINE' | 'OFFLINE' | 'PENDING_PROVISION' | 'UNCLAIMED' | 'REBOOTING';
  last_heartbeat_at: string | null;
  last_ip: string;
  created_at: string;
  updated_at?: string;
  rssi?: number;
  cellular_rssi?: number;
  rsrp?: number;
  cellular_rsrp?: number;
  cellular_sinr?: number;
  cellular_rsrq?: number;
  carrier?: string;
  cellular_carrier?: string;
  cpu_load?: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
  flash_free_mb?: number;
  uptime_seconds?: number;
}

export interface TelemetryRecord {
  id: number;
  device_id: string;
  timestamp: string;
  rssi?: number;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  carrier?: string;
  net_type?: string;
  uptime_seconds?: number;
  cpu_load?: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
  flash_free_mb?: number;
  rx_bytes?: number;
  tx_bytes?: number;
}

export interface DashboardSummary {
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  pending_devices?: number;
  active_tunnels: number;
  data_usage_gb: number;
}

export interface Incident {
  id: string;
  rule_name: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  device_name: string;
  serial_number: string;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  message: string;
  triggered_at: string;
  resolved_at?: string;
}

export interface AuditLog {
  id: string;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  ip_address: string;
  created_at: string;
}

export const login = async (email: string, password: string) => {
  const res = await api.post('/auth/login', { email, password });
  if (res.data.token) {
    localStorage.setItem('niseva_token', res.data.token);
    localStorage.setItem('niseva_user', JSON.stringify(res.data.user));
  }
  return res.data;
};

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  const res = await api.get('/dashboard/summary');
  return res.data;
};

export const getDevices = async (): Promise<Device[]> => {
  const res = await api.get('/devices');
  return res.data;
};

export const getDevice = async (id: string): Promise<Device> => {
  const res = await api.get(`/devices/${id}`);
  return res.data;
};

export const getDeviceTelemetry = async (id: string, limit = 50): Promise<TelemetryRecord[]> => {
  const res = await api.get(`/devices/${id}/telemetry?limit=${limit}`);
  return res.data;
};

export const claimDevice = async (data: {
  serial_number: string;
  mac_address: string;
  device_secret: string;
  name?: string;
}) => {
  const res = await api.post('/devices/claim', data);
  return res.data;
};

export const rebootDevice = async (id: string) => {
  const res = await api.post(`/devices/${id}/reboot`);
  return res.data;
};

export const requestTunnel = async (
  deviceId: string,
  protocol: 'HTTP_LUCI' | 'TERMINAL_SSH' | 'SFTP',
  targetPort?: number
) => {
  const res = await api.post('/tunnels/request', {
    device_id: deviceId,
    protocol,
    target_port: targetPort,
  });
  return res.data;
};

export const getIncidents = async (): Promise<Incident[]> => {
  const res = await api.get('/alerts/incidents');
  return res.data;
};

export const getAuditLogs = async (): Promise<AuditLog[]> => {
  const res = await api.get('/audit-logs');
  return res.data;
};

export default api;
