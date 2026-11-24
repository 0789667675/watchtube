import { create, isAxiosError, type AxiosInstance } from 'axios';

const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;

export function resolveApiBaseUrl(
  rawUrl: string | undefined,
  devMode = isDevelopment,
): { baseUrl?: string; error: string | null } {
  const normalized = rawUrl?.trim().replace(/\/+$/, '');
  if (!normalized) return { baseUrl: undefined, error: null };

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return {
      baseUrl: undefined,
      error: 'EXPO_PUBLIC_API_BASE_URL must be an absolute HTTP(S) API origin.',
    };
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    return {
      baseUrl: undefined,
      error: 'EXPO_PUBLIC_API_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.',
    };
  }
  if (!devMode && url.protocol !== 'https:') {
    return {
      baseUrl: undefined,
      error: 'Production builds require an HTTPS EXPO_PUBLIC_API_BASE_URL.',
    };
  }

  return { baseUrl: `${normalized}/api/v1`, error: null };
}

const resolvedConfig = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, isDevelopment);
const apiConfigurationError = resolvedConfig.error;
const apiBaseUrl = resolvedConfig.baseUrl;

export function createWatchTubeApiClient(baseURL?: string): AxiosInstance {
  return create({
    baseURL,
    timeout: 15_000,
    withCredentials: true,
    headers: { Accept: 'application/json' },
  });
}

export const apiClient = createWatchTubeApiClient(apiBaseUrl);

function assertApiConfigured(): void {
  if (apiConfigurationError) throw new Error(apiConfigurationError);
  if (!apiBaseUrl) {
    throw new Error('The API is not configured. Set EXPO_PUBLIC_API_BASE_URL to the WatchTube API origin and restart Expo.');
  }
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean>,
  signal?: AbortSignal,
): Promise<T> {
  assertApiConfigured();
  const { data } = await apiClient.get<T>(path, { params, signal });
  return data;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  assertApiConfigured();
  const { data } = await apiClient.post<T>(path, body);
  return data;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  assertApiConfigured();
  const { data } = await apiClient.patch<T>(path, body);
  return data;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<{ error?: unknown }>(error)) {
    const message = error.response?.data?.error;
    if (typeof message === 'string') return message;
    const status = error.response?.status;
    if (status === 401) return 'Sign in to continue.';
    if (status === 403) return 'Your account is not permitted to perform this action.';
    if (status === 404) return 'This content is no longer available.';
    if (status === 429) return 'Too many requests. Wait a moment and try again.';
    if (status !== undefined && status >= 500) return 'WatchTube is temporarily unavailable. Please try again.';
    if (
      !error.response
      && ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(error.code ?? '')
    ) {
      return 'The WatchTube API could not be reached. Check the network and API address, then retry.';
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export function getUploadTransferStatusError(status: number): string {
  if (status === 401 || status === 403) {
    return `Cloud storage rejected the binary upload (HTTP ${status}). Verify R2 credentials, PutObject permissions, and bucket CORS, then retry.`;
  }
  if (status === 429) {
    return 'Cloud storage is temporarily throttling uploads (HTTP 429). Wait briefly, then retry.';
  }
  if (status >= 500) {
    return `Cloud storage returned a server error (HTTP ${status}). Retry in a moment.`;
  }
  return `Binary upload failed with storage status HTTP ${status}.`;
}

export function getUploadTransferErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = 'status' in error && typeof error.status === 'number'
    ? error.status
    : isAxiosError(error) ? error.response?.status : undefined;
  if (typeof status === 'number' && status >= 400) {
    return getUploadTransferStatusError(status);
  }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code && ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)) {
    return 'The cloud storage upload endpoint could not be reached. Check network connectivity and R2 CORS settings, then retry.';
  }
  return null;
}

export function isUnauthorizedError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401;
}

export function getSessionCheckFailure(error: unknown): { clearSession: boolean; message: string | null } {
  if (isUnauthorizedError(error)) return { clearSession: true, message: null };
  if (isAxiosError(error) && error.response?.status === 403) {
    return {
      clearSession: true,
      message: getApiErrorMessage(error, 'This account cannot access WatchTube.'),
    };
  }
  return {
    clearSession: false,
    message: getApiErrorMessage(error, 'Your session could not be checked.'),
  };
}
