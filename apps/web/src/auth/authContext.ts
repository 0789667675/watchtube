import { createContext } from 'react';
import type { AuthChannel, AuthState } from './authTypes';

export interface AuthContextValue {
  state: AuthState;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  addChannel: (channel: AuthChannel) => void;
  updateChannel: (channel: AuthChannel) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
