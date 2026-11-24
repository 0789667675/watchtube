export type AuthRole = 'VIEWER' | 'CREATOR' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN' | 'USER';
export type AuthUserStatus = 'GOOD_STANDING' | 'WARNING' | 'RESTRICTED' | 'SUSPENDED';

export interface AuthChannel {
  id: string;
  name: string;
  handle: string;
  description?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  role: AuthRole;
  status: AuthUserStatus;
  channels: AuthChannel[];
  positionNumber?: number | null;
  assignment?: string | null;
  permissions?: string[];
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'unavailable'; message: string }
  | { status: 'authenticated'; user: AuthUser };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuthChannel(value: unknown): value is AuthChannel {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.handle === 'string'
    && (value.description === undefined || value.description === null || typeof value.description === 'string')
    && (value.avatarUrl === undefined || value.avatarUrl === null || typeof value.avatarUrl === 'string')
    && (value.bannerUrl === undefined || value.bannerUrl === null || typeof value.bannerUrl === 'string');
}

export function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.email === 'string'
    && (value.role === 'VIEWER' || value.role === 'CREATOR' || value.role === 'MODERATOR' || value.role === 'ADMIN' || value.role === 'SUPER_ADMIN' || value.role === 'USER')
    && (value.status === 'GOOD_STANDING'
      || value.status === 'WARNING'
      || value.status === 'RESTRICTED'
      || value.status === 'SUSPENDED')
    && Array.isArray(value.channels)
    && value.channels.every(isAuthChannel);
}
