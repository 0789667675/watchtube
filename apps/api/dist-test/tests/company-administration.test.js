"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const permissions_1 = require("../src/security/permissions");
const audit_service_1 = require("../src/services/audit.service");
const adminManagement_service_1 = require("../src/services/adminManagement.service");
(0, node_test_1.describe)('Company Administration & Security Architecture', () => {
    (0, node_test_1.describe)('RBAC & Permission Matrix Enforcement', () => {
        (0, node_test_1.it)('SUPER_ADMIN (Owner/CEO) has full access across all platform capabilities', () => {
            const superAdmin = {
                role: 'SUPER_ADMIN',
                status: 'GOOD_STANDING',
            };
            for (const perm of permissions_1.BASE_ADMIN_PERMISSIONS) {
                strict_1.default.equal((0, permissions_1.hasPermission)(superAdmin, perm), true);
            }
            for (const perm of permissions_1.OWNER_ONLY_PERMISSIONS) {
                strict_1.default.equal((0, permissions_1.hasPermission)(superAdmin, perm), true);
            }
            strict_1.default.equal((0, permissions_1.hasPermission)(superAdmin, 'custom.any_future_permission'), true);
        });
        (0, node_test_1.it)('ADMIN receives all base creator-support permissions automatically', () => {
            const admin = {
                role: 'ADMIN',
                status: 'GOOD_STANDING',
                permissions: [],
            };
            for (const perm of permissions_1.BASE_ADMIN_PERMISSIONS) {
                strict_1.default.equal((0, permissions_1.hasPermission)(admin, perm), true, `Expected ADMIN to have base permission: ${perm}`);
            }
        });
        (0, node_test_1.it)('ADMIN is strictly forbidden from all OWNER_ONLY_PERMISSIONS', () => {
            const adminWithWildcard = {
                role: 'ADMIN',
                status: 'GOOD_STANDING',
                permissions: ['*'], // Even with a wildcard, owner-only permissions must fail closed
            };
            for (const perm of permissions_1.OWNER_ONLY_PERMISSIONS) {
                strict_1.default.equal((0, permissions_1.hasPermission)(adminWithWildcard, perm), false, `Security violation: ADMIN should never have owner-only permission: ${perm}`);
            }
        });
        (0, node_test_1.it)('ADMIN receives individually assigned additional permissions', () => {
            const admin = {
                role: 'ADMIN',
                status: 'GOOD_STANDING',
                permissions: ['monetization.view', 'subscriptions.view', 'finance.creator_support_view'],
            };
            strict_1.default.equal((0, permissions_1.hasPermission)(admin, 'monetization.view'), true);
            strict_1.default.equal((0, permissions_1.hasPermission)(admin, 'subscriptions.view'), true);
            strict_1.default.equal((0, permissions_1.hasPermission)(admin, 'finance.creator_support_view'), true);
            strict_1.default.equal((0, permissions_1.hasPermission)(admin, 'finance.view_company_revenue'), false); // Owner only!
        });
        (0, node_test_1.it)('ADMIN supports namespace wildcards for granted operational permissions', () => {
            const admin = {
                role: 'ADMIN',
                status: 'GOOD_STANDING',
                permissions: ['community.*'],
            };
            strict_1.default.equal((0, permissions_1.hasPermission)(admin, 'community.moderate_comments'), true);
            strict_1.default.equal((0, permissions_1.hasPermission)(admin, 'community.manage_strikes'), true);
            strict_1.default.equal((0, permissions_1.hasPermission)(admin, 'finance.view_expenses'), false);
        });
        (0, node_test_1.it)('Suspended or restricted accounts cannot perform privileged operations', () => {
            const suspendedAdmin = {
                role: 'ADMIN',
                status: 'SUSPENDED',
                permissions: ['*'],
            };
            const restrictedAdmin = {
                role: 'ADMIN',
                status: 'RESTRICTED',
                permissions: ['*'],
            };
            const suspendedPositionAdmin = {
                role: 'ADMIN',
                status: 'GOOD_STANDING',
                positionStatus: 'SUSPENDED',
                permissions: ['creator_support.view'],
            };
            strict_1.default.equal((0, permissions_1.hasPermission)(suspendedAdmin, 'creator_support.view'), false);
            strict_1.default.equal((0, permissions_1.hasPermission)(restrictedAdmin, 'creator_support.view'), false);
            strict_1.default.equal((0, permissions_1.hasPermission)(suspendedPositionAdmin, 'creator_support.view'), false);
            const vacantPositionAdmin = {
                role: 'ADMIN',
                status: 'GOOD_STANDING',
                positionStatus: 'VACANT',
                permissions: ['creator_support.view'],
            };
            strict_1.default.equal((0, permissions_1.hasPermission)(vacantPositionAdmin, 'creator_support.view'), false);
        });
        (0, node_test_1.it)('Ordinary USER accounts have no administrative or creator-support permissions', () => {
            const user = {
                role: 'USER',
                status: 'GOOD_STANDING',
            };
            const viewer = {
                role: 'VIEWER',
                status: 'GOOD_STANDING',
            };
            strict_1.default.equal((0, permissions_1.hasPermission)(user, 'creator_support.view'), false);
            strict_1.default.equal((0, permissions_1.hasPermission)(viewer, 'reports.view'), false);
            strict_1.default.equal((0, permissions_1.hasPermission)(user, 'platform.view_health'), false);
        });
    });
    (0, node_test_1.describe)('Admin Invitation & Token Security', () => {
        (0, node_test_1.it)('Token hashing is deterministic and irreversible using sha256', () => {
            const rawToken = '68c838e4a9b6c4b2671e21b71d604b3917a1e0b5ff9d443216898f7e2d9370ce';
            const hash1 = (0, adminManagement_service_1.hashToken)(rawToken);
            const hash2 = (0, adminManagement_service_1.hashToken)(rawToken);
            strict_1.default.equal(hash1, hash2);
            strict_1.default.equal(hash1.length, 64);
            strict_1.default.notEqual(rawToken, hash1);
        });
        (0, node_test_1.it)('Owner-only permissions cannot be passed into invitation customPermissions', () => {
            const requestedPermissions = [
                'creator_support.view',
                'monetization.view',
                'admins.manage',
                'finance.view_company_revenue',
                'security.manage_policies',
            ];
            const safePermissions = requestedPermissions.filter((perm) => !permissions_1.OWNER_ONLY_PERMISSIONS.includes(perm));
            strict_1.default.deepEqual(safePermissions, ['creator_support.view', 'monetization.view']);
            strict_1.default.equal(safePermissions.includes('admins.manage'), false);
            strict_1.default.equal(safePermissions.includes('finance.view_company_revenue'), false);
        });
    });
    (0, node_test_1.describe)('Audit Log Sanitization & Security', () => {
        (0, node_test_1.it)('Redacts sensitive credentials, tokens, and PII from audit metadata', () => {
            const sensitiveInput = {
                email: 'partner@example.com',
                positionNumber: 1,
                password: 'SuperSecretPassword123',
                passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
                token: 'raw-invite-token-value',
                secret: 'api-secret-key',
                authorization: 'Bearer jwt-token-value',
                cookie: 'token=xyz',
                taxId: '123456789',
                nationalId: 'ID-99999',
                passport: 'P-123456',
                nested: {
                    key: 'private-key-material',
                    safeField: 'safe-value',
                },
            };
            const sanitized = (0, audit_service_1.sanitizeAuditMetadata)(sensitiveInput);
            strict_1.default.equal(sanitized.email, 'partner@example.com');
            strict_1.default.equal(sanitized.positionNumber, 1);
            strict_1.default.equal(sanitized.password, '[REDACTED]');
            strict_1.default.equal(sanitized.passwordHash, '[REDACTED]');
            strict_1.default.equal(sanitized.token, '[REDACTED]');
            strict_1.default.equal(sanitized.secret, '[REDACTED]');
            strict_1.default.equal(sanitized.authorization, '[REDACTED]');
            strict_1.default.equal(sanitized.cookie, '[REDACTED]');
            strict_1.default.equal(sanitized.taxId, '[REDACTED]');
            strict_1.default.equal(sanitized.nationalId, '[REDACTED]');
            strict_1.default.equal(sanitized.passport, '[REDACTED]');
            strict_1.default.equal(sanitized.nested.key, '[REDACTED]');
            strict_1.default.equal(sanitized.nested.safeField, 'safe-value');
        });
        (0, node_test_1.it)('Leaves non-object primitive metadata untouched', () => {
            strict_1.default.equal((0, audit_service_1.sanitizeAuditMetadata)(null), null);
            strict_1.default.equal((0, audit_service_1.sanitizeAuditMetadata)(undefined), null);
            strict_1.default.equal((0, audit_service_1.sanitizeAuditMetadata)('simple-string'), 'simple-string');
            strict_1.default.equal((0, audit_service_1.sanitizeAuditMetadata)(12345), 12345);
        });
    });
});
