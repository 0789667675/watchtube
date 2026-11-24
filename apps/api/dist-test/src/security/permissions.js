"use strict";
/**
 * WatchTube Platform Permissions Matrix
 *
 * Defines scoped, backend-enforced permissions for SUPER_ADMIN, ADMIN partners, and future MODERATORS.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWNER_ONLY_PERMISSIONS = exports.CONFIGURABLE_ADMIN_PERMISSIONS = exports.BASE_ADMIN_PERMISSIONS = void 0;
exports.hasPermission = hasPermission;
// Base permissions granted to all three ADMIN positions for everyday operational and creator-support work.
exports.BASE_ADMIN_PERMISSIONS = [
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
];
// Additional permissions that can be individually granted to an ADMIN position by the SUPER_ADMIN.
// Note: Financial intelligence, payout execution, payment secrets, and provider credentials are NEVER here.
exports.CONFIGURABLE_ADMIN_PERMISSIONS = [
    'monetization.view',
    'subscriptions.view',
    'finance.creator_support_view',
    'content.takedown',
    'community.manage_strikes',
    'users.suspend',
    'platform.manage_cache',
];
// Owner-only permissions strictly reserved for the SUPER_ADMIN (CEO/Founder).
// These can NEVER be granted to or executed by ordinary ADMIN accounts under any circumstances.
exports.OWNER_ONLY_PERMISSIONS = [
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
];
/**
 * Validates whether an authenticated user has the required permission.
 * Strictly enforces owner protection and account/position standing.
 */
function hasPermission(user, requiredPermission) {
    if (!user || !user.role)
        return false;
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
    if (exports.OWNER_ONLY_PERMISSIONS.includes(requiredPermission)) {
        return false;
    }
    // ADMIN accounts receive base creator-support permissions and any assigned permissions
    if (user.role === 'ADMIN') {
        // If the Admin's position is not occupied (e.g. revoked, vacant, or suspended), deny all admin permissions
        if (user.positionStatus && user.positionStatus !== 'OCCUPIED') {
            return false;
        }
        if (exports.BASE_ADMIN_PERMISSIONS.includes(requiredPermission)) {
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
