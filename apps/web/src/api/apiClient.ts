import axios from 'axios';

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const apiClient = axios.create({
  baseURL: configuredBaseUrl ? configuredBaseUrl.replace(/\/+$/, '') : undefined,
  withCredentials: true,
});

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ error?: unknown }>(error)) {
    const message = error.response?.data?.error;
    if (typeof message === 'string') return message;
  }
  return fallback;
}
