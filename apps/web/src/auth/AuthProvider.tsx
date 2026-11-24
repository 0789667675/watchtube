import axios from 'axios';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  apiClient,
  getApiErrorMessage,
  subscribeToUnauthorized,
} from '../api/apiClient';
import { AuthContext, type AuthContextValue } from './authContext';
import type { AuthChannel, AuthState } from './authTypes';
import { isAuthUser } from './authTypes';

function authenticationError(error: unknown): string {
  return getApiErrorMessage(error, 'Your WatchTube account could not be verified. Please retry.');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const requestVersion = useRef(0);

  const clearSession = useCallback(() => {
    requestVersion.current += 1;
    setState({ status: 'unauthenticated' });
  }, []);

  useEffect(() => subscribeToUnauthorized(clearSession), [clearSession]);

  const restore = useCallback(async (signal?: AbortSignal) => {
    const request = ++requestVersion.current;
    try {
      const { data } = await apiClient.get<unknown>('/api/v1/auth/me', { signal });
      if (!isAuthUser(data)) {
        throw new Error('The account response was invalid.');
      }
      if (request === requestVersion.current) {
        setState({ status: 'authenticated', user: data });
      }
    } catch (error) {
      if (signal?.aborted || request !== requestVersion.current) return;
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setState({ status: 'unauthenticated' });
      } else {
        setState({ status: 'unavailable', message: authenticationError(error) });
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Keep the initial loading state until the HttpOnly session cookie is verified.
    // oxlint-disable-next-line react/set-state-in-effect
    void restore(controller.signal);
    return () => controller.abort();
  }, [restore]);

  const login = useCallback(async (credentials: { email: string; password: string }) => {
    const request = ++requestVersion.current;
    setState({ status: 'loading' });
    try {
      await apiClient.post('/api/v1/auth/login', credentials);
      const { data } = await apiClient.get<unknown>('/api/v1/auth/me');
      if (!isAuthUser(data)) {
        throw new Error('The account response was invalid.');
      }
      if (request === requestVersion.current) {
        setState({ status: 'authenticated', user: data });
      }
    } catch (error) {
      if (request === requestVersion.current) {
        setState(axios.isAxiosError(error) && error.response?.status === 401
          ? { status: 'unauthenticated' }
          : { status: 'unavailable', message: authenticationError(error) });
      }
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    await apiClient.post('/api/v1/auth/logout');
    clearSession();
  }, [clearSession]);

  const refresh = useCallback(() => {
    setState({ status: 'loading' });
    return restore();
  }, [restore]);

  const addChannel = useCallback((channel: AuthChannel) => {
    setState((current) => current.status === 'authenticated'
      ? {
        ...current,
        user: {
          ...current.user,
          channels: current.user.channels.some((item) => item.id === channel.id)
            ? current.user.channels
            : [...current.user.channels, channel],
        },
      }
      : current);
  }, []);

  const updateChannel = useCallback((channel: AuthChannel) => {
    setState((current) => current.status === 'authenticated'
      ? {
        ...current,
        user: {
          ...current.user,
          channels: current.user.channels.map((item) =>
            item.id === channel.id ? { ...item, ...channel } : item),
        },
      }
      : current);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    login,
    logout,
    refresh,
    addChannel,
    updateChannel,
  }), [state, login, logout, refresh, addChannel, updateChannel]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
