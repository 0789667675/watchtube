import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import {
  apiGet,
  apiPost,
  getApiErrorMessage,
  getSessionCheckFailure,
  isUnauthorizedError,
} from '@/api/client';
import { assertAuthSuccess, parseSession, type MobileUserSession } from '@/api/contracts';
import { shouldRefreshSessionOnForeground } from '@/auth/sessionLifecycle';

interface AuthContextValue {
  user: MobileUserSession | null;
  isCheckingSession: boolean;
  sessionError: string | null;
  refreshSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  createChannel: (input: { name: string; handle: string; description?: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MobileUserSession | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setIsCheckingSession(true);
    setSessionError(null);
    try {
      setUser(parseSession(await apiGet<unknown>('/auth/me')));
    } catch (error) {
      const failure = getSessionCheckFailure(error);
      if (failure.clearSession) setUser(null);
      setSessionError(failure.message);
    } finally {
      setIsCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiGet<unknown>('/auth/me')
      .then((session) => {
        if (active) {
          setUser(parseSession(session));
          setSessionError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const failure = getSessionCheckFailure(error);
          if (failure.clearSession) setUser(null);
          setSessionError(failure.message);
        }
      })
      .finally(() => {
        if (active) setIsCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (shouldRefreshSessionOnForeground(previousState, nextState)) {
        void refreshSession();
      }
      previousState = nextState;
    });

    return () => subscription.remove();
  }, [refreshSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    setSessionError(null);
    let loginAccepted = false;
    try {
      assertAuthSuccess(await apiPost<unknown>('/auth/login', { email, password }), 'sign-in');
      loginAccepted = true;
      const session = parseSession(await apiGet<unknown>('/auth/me'));
      if (!session) {
        throw new Error('The API did not establish a session after sign-in.');
      }
      setUser(session);
    } catch (error) {
      setUser(null);
      const message = loginAccepted && isUnauthorizedError(error)
        ? 'Sign-in completed, but the native API session cookie was not accepted. Check the API host and cookie support, then retry.'
        : getApiErrorMessage(error, 'Sign-in failed. Please try again.');
      throw new Error(message);
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setSessionError(null);
    try {
      const regResult = await apiPost<unknown>('/auth/register', { email, password });
      assertAuthSuccess(regResult, 'register');
    } catch (error) {
      throw new Error(
        getApiErrorMessage(error, 'Registration failed. Please check your details and try again.'),
      );
    }
    await signIn(email, password);
  }, [signIn]);

  const createChannel = useCallback(async (input: { name: string; handle: string; description?: string }) => {
    setSessionError(null);
    try {
      await apiPost<unknown>('/channels', input);
      const session = parseSession(await apiGet<unknown>('/auth/me'));
      if (session) setUser(session);
    } catch (error) {
      throw new Error(getApiErrorMessage(error, 'Channel creation failed. Please try again.'));
    }
  }, []);

  const signOut = useCallback(async () => {
    setSessionError(null);
    try {
      assertAuthSuccess(await apiPost<unknown>('/auth/logout'), 'sign-out');
      setUser(null);
    } catch (error) {
      throw new Error(getApiErrorMessage(error, 'Sign-out failed. Please retry.'));
    }
  }, []);

  const value = useMemo(() => ({
    user,
    isCheckingSession,
    sessionError,
    refreshSession,
    signIn,
    register,
    createChannel,
    signOut,
  }), [user, isCheckingSession, sessionError, refreshSession, signIn, register, createChannel, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthSession must be used inside AuthProvider.');
  return context;
}
