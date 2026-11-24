import axios from 'axios';

const configuredBaseUrl = (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_API_BASE_URL : undefined)?.trim();

export const apiClient = axios.create({
  baseURL: configuredBaseUrl ? configuredBaseUrl.replace(/\/+$/, '') : undefined,
  withCredentials: true,
});

const unauthorizedListeners = new Set<() => void>();

apiClient.interceptors.response.use(undefined, (error: unknown) => {
  if (
    axios.isAxiosError(error)
    && error.response?.status === 401
    && !/\/auth\/(?:login|register)(?:[?#]|$)/.test(error.config?.url ?? '')
  ) {
    unauthorizedListeners.forEach((listener) => listener());
  }
  return Promise.reject(error);
});

export function subscribeToUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/https?:\/\/[^\s?#]+r2\.cloudflarestorage\.com[^\s]*/gi, '[storage endpoint]')
    .replace(/[?&]X-Amz-[A-Za-z0-9_-]+=[^&\s]+/gi, '')
    .trim();
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ error?: unknown; code?: unknown }>(error)) {
    const code = typeof error.response?.data?.code === 'string'
      ? error.response.data.code
      : undefined;
    if (code === 'STORAGE_CONFIGURATION') {
      return 'Cloud storage is not configured in this API environment. Configure R2 credentials and public media settings, then retry.';
    }
    if (code === 'STORAGE_PERMISSION') {
      return 'Cloud storage rejected the upload. Check R2 credentials and bucket permissions, then retry.';
    }
    if (code === 'STORAGE_NETWORK') {
      return 'Cloud storage could not be reached. Check network connectivity and retry.';
    }
    if (code === 'STORAGE_THROTTLED') {
      return 'Cloud storage is temporarily throttling uploads. Wait briefly, then retry.';
    }
    if (code === 'STORAGE_TEMPORARY') {
      return 'Cloud storage is temporarily unavailable. Retry in a moment.';
    }
    if (error.response?.status === 403) {
      return 'Cloud storage rejected the upload. Check R2 credentials, bucket permissions, and CORS, then retry.';
    }
    if (error.response?.status === 429) {
      return 'Cloud storage is temporarily throttling uploads. Wait briefly, then retry.';
    }
    const message = error.response?.data?.error;
    if (typeof message === 'string') return message;
    if (
      error.response?.status === 502
      || error.response?.status === 504
      || error.code === 'ERR_NETWORK'
    ) {
      return 'The WatchTube API could not be reached. Check the API service connection, then retry.';
    }
    return fallback;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return sanitizeErrorMessage(error.message);
  }
  return fallback;
}
