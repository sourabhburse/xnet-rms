import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('niseva_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface Device {
  id: string;
  serial_number: string;
  mac_address: string;
  model: string;
  name: string;
  imei: string;
  firmware_version: string;
  status: 'ONLINE' | 'OFFLINE' | 'PENDING_PROVISION' | 'UNCLAIMED' | 'REBOOTING';
  last_heartbeat_at: string | null;
  last_ip: string;
  created_at: string;
}

export interface DashboardSummary {
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  active_tunnels: number;
  data_usage_gb: number;
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

export default api;
