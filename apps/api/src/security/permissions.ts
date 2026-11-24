/**
 * WatchTube Platform Permissions Matrix
 *
 * Defines scoped, backend-enforced permissions for SUPER_ADMIN, ADMIN partners, and future MODERATORS.
 */

// Base permissions granted to all three ADMIN positions for everyday operational and creator-support work.
export const BASE_ADMIN_PERMISSIONS = [
  'creator_support.view',
  'creator_support.manage',
  'creator_support.assign',
  'creator_support.resolve',
  'creators.view',
  'creators.support',
  'users.view',
  'users.support',
  'content.review',
  'reports.view',
  'reports.resolve',
  'community.moderate',
  'platform.view_health',
  'audit.view_operational',
  'approvals.create',
] as const;

// Additional permissions that can be individually granted to an ADMIN position by the SUPER_ADMIN.
// Note: Financial intelligence, payout execution, payment secrets, and provider credentials are NEVER here.
export const CONFIGURABLE_ADMIN_PERMISSIONS = [
  'monetization.view',
  'subscriptions.view',
  'finance.creator_support_view',
  'content.takedown',
  'community.manage_strikes',
  'users.suspend',
  'platform.manage_cache',
] as const;

// Owner-only permissions strictly reserved for the SUPER_ADMIN (CEO/Founder).
// These can NEVER be granted to or executed by ordinary ADMIN accounts under any circumstances.
export const OWNER_ONLY_PERMISSIONS = [
  'admins.manage',
  'admins.invite',
  'admins.revoke',
  'admins.suspend',
  'admins.assign_permissions',
  'company.view_overview',
  'company.manage_settings',
  'finance.view_company_revenue',
  'finance.view_expenses',
  'finance.manage_payouts',
  'finance.reconcile',
  'payments.execute',
  'payments.configure',
  'payments.secrets.manage',
  'monetization.manage_providers',
  'monetization.manage_provider_credentials',
  'monetization.configure_rates',
  'security.manage_policies',
  'audit.view_all',
  'approvals.review',
] as const;

export type Permission =
  | typeof BASE_ADMIN_PERMISSIONS[number]
  | typeof CONFIGURABLE_ADMIN_PERMISSIONS[number]
  | typeof OWNER_ONLY_PERMISSIONS[number]
  | string;

export interface PermissionCheckUser {
  role: string;
  status: string;
  permissions?: string[];
  positionStatus?: string;
}

/**
 * Validates whether an authenticated user has the required permission.
 * Strictly enforces owner protection and account/position standing.
 */
export function hasPermission(
  user: PermissionCheckUser,
  requiredPermission: Permission,
): boolean {
  if (!user || !user.role) return false;

  // Suspended or restricted accounts cannot perform privileged operations
  if (user.status === 'SUSPENDED' || user.status === 'RESTRICTED') {
    return false;
  }

  // Suspended admin positions cannot perform privileged operations
  if (user.positionStatus === 'SUSPENDED') {
    return false;
  }

  // SUPER_ADMIN (CEO/Owner) has full, comprehensive authority across the entire platform
  if (user.role === 'SUPER_ADMIN') {
    return true;
  }

  // If the required permission is strictly owner-only, reject any non-SUPER_ADMIN
  if ((OWNER_ONLY_PERMISSIONS as readonly string[]).includes(requiredPermission)) {
    return false;
  }

  // ADMIN accounts receive base creator-support permissions and any assigned permissions
  if (user.role === 'ADMIN') {
    // If the Admin's position is not occupied (e.g. revoked, vacant, or suspended), deny all admin permissions
    if (user.positionStatus && user.positionStatus !== 'OCCUPIED') {
      return false;
    }

    if ((BASE_ADMIN_PERMISSIONS as readonly string[]).includes(requiredPermission)) {
      return true;
    }

    const assigned = user.permissions ?? [];
    if (assigned.includes('*')) {
      return true;
    }

    if (assigned.includes(requiredPermission)) {
      return true;
    }

    // Check namespace wildcard, e.g. "creator_support.*" covers "creator_support.view"
    const [namespace] = requiredPermission.split('.');
    if (namespace && assigned.includes(`${namespace}.*`)) {
      return true;
    }

    return false;
  }

  // Future MODERATORS: only explicit scoped permissions
  if (user.role === 'MODERATOR') {
    const assigned = user.permissions ?? [];
    return assigned.includes(requiredPermission);
  }

  return false;
}
