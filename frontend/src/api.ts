export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function formatApiError(err: unknown): { title: string; message: string; type: 'error' | 'warning' | 'info' } {
  if (err instanceof ApiError) {
    const msg = (err.message || '').toLowerCase();
    const code = (err.code || '').toLowerCase();

    if (err.status === 401) {
      return {
        title: 'Authentication Required',
        message: 'Your session has expired or is invalid. Please sign in again.',
        type: 'warning',
      };
    }

    if (err.status === 403) {
      if (code === 'revoked' || msg.includes('revoked')) {
        return {
          title: 'Device Revoked',
          message: 'This router certificate has been permanently revoked.',
          type: 'error',
        };
      }
      return {
        title: 'Access Denied',
        message: 'Your role has insufficient permissions to perform this operation.',
        type: 'error',
      };
    }

    if (err.status === 404) {
      return {
        title: 'Not Found',
        message: err.message || 'The requested resource could not be found.',
        type: 'error',
      };
    }

    if (err.status === 409) {
      if (msg.includes('session maximum duration')) {
        return {
          title: 'Maximum Session Duration Reached',
          message: 'This session has already reached its one-hour maximum. Close it and open a new session if you still need access.',
          type: 'warning',
        };
      }
      if (msg.includes('session expired')) {
        return {
          title: 'Session Expired',
          message: 'This remote session has expired. Open a new session to continue.',
          type: 'warning',
        };
      }
      if (msg.includes('router busy')) {
        return {
          title: 'Router Busy',
          message: 'Another remote session is currently active on this device. Wait for it to close or expire, then retry.',
          type: 'warning',
        };
      }
      if (msg.includes('device unavailable')) {
        return {
          title: 'Device Offline',
          message: 'The router is currently offline or unreachable. Remote actions require the router to be online.',
          type: 'warning',
        };
      }
      if (code === 'identity_conflict' || msg.includes('conflict')) {
        return {
          title: 'Conflict Detected',
          message: 'A device, registration, or tag with this identity or LAN MAC already exists.',
          type: 'error',
        };
      }
      return {
        title: 'State Conflict',
        message: err.message || 'The action could not be completed due to a resource state conflict.',
        type: 'error',
      };
    }

    if (err.status === 429) {
      if (msg.includes('session capacity reached')) {
        return {
          title: 'Session Capacity Reached',
          message: 'The platform has reached the maximum of 25 active concurrent sessions. Please close unused sessions or wait.',
          type: 'warning',
        };
      }
      return {
        title: 'Too Many Requests',
        message: 'Rate limit reached. Please wait a few seconds before retrying.',
        type: 'warning',
      };
    }

    if (err.status === 503) {
      if (msg.includes('connecting') || msg.includes('router command dispatch failed')) {
        return {
          title: 'Router Connecting',
          message: 'The router is establishing its secure outbound tunnel. Please wait a few moments and retry.',
          type: 'info',
        };
      }
      return {
        title: 'Service Temporarily Unavailable',
        message: 'The RMS service is currently busy or re-synchronizing. Please retry shortly.',
        type: 'warning',
      };
    }

    return {
      title: `Error (${err.status})`,
      message: err.message || 'An unexpected error occurred.',
      type: 'error',
    };
  }

  return {
    title: 'Unexpected Error',
    message: err instanceof Error ? err.message : String(err),
    type: 'error',
  };
}

export async function api<T = any>(
  path: string,
  method = 'GET',
  data?: unknown,
  isCsv = false
): Promise<T> {
  const url = '/api/v1/' + path;
  const headers: Record<string, string> = {};

  if (isCsv) {
    headers['Content-Type'] = 'text/csv';
  } else if (data !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  let body: string | undefined = undefined;
  if (data !== undefined && method !== 'GET') {
    body = isCsv ? String(data) : JSON.stringify(data);
  }

  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body,
  });

  if (response.status === 204) {
    return null as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!isCsv && !contentType.includes('application/json')) {
    throw new ApiError('Unexpected non-JSON response from server', 503);
  }

  let payload: any;
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    payload = await response.text();
  }

  if (!response.ok) {
    const errorMsg =
      (payload && typeof payload === 'object' && payload.error) ||
      (typeof payload === 'string' && payload) ||
      `Request failed with status ${response.status}`;
    const errorCode = payload && typeof payload === 'object' ? payload.code : undefined;
    throw new ApiError(errorMsg, response.status, errorCode, payload);
  }

  return payload as T;
}
