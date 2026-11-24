import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPermission,
  BASE_ADMIN_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
} from '../src/security/permissions';
import { sanitizeAuditMetadata } from '../src/services/audit.service';
import { hashToken } from '../src/services/adminManagement.service';

describe('Company Administration & Security Architecture', () => {
  describe('RBAC & Permission Matrix Enforcement', () => {
    it('SUPER_ADMIN (Owner/CEO) has full access across all platform capabilities', () => {
      const superAdmin = {
        role: 'SUPER_ADMIN',
        status: 'GOOD_STANDING',
      };

      for (const perm of BASE_ADMIN_PERMISSIONS) {
        assert.equal(hasPermission(superAdmin, perm), true);
      }
      for (const perm of OWNER_ONLY_PERMISSIONS) {
        assert.equal(hasPermission(superAdmin, perm), true);
      }
      assert.equal(hasPermission(superAdmin, 'custom.any_future_permission'), true);
    });

    it('ADMIN receives all base creator-support permissions automatically', () => {
      const admin = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        permissions: [],
      };

      for (const perm of BASE_ADMIN_PERMISSIONS) {
        assert.equal(hasPermission(admin, perm), true, `Expected ADMIN to have base permission: ${perm}`);
      }
    });

    it('ADMIN is strictly forbidden from all OWNER_ONLY_PERMISSIONS', () => {
      const adminWithWildcard = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        permissions: ['*'], // Even with a wildcard, owner-only permissions must fail closed
      };

      for (const perm of OWNER_ONLY_PERMISSIONS) {
        assert.equal(
          hasPermission(adminWithWildcard, perm),
          false,
          `Security violation: ADMIN should never have owner-only permission: ${perm}`,
        );
      }
    });

    it('ADMIN receives individually assigned additional permissions', () => {
      const admin = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        permissions: ['monetization.view', 'subscriptions.view', 'finance.creator_support_view'],
      };

      assert.equal(hasPermission(admin, 'monetization.view'), true);
      assert.equal(hasPermission(admin, 'subscriptions.view'), true);
      assert.equal(hasPermission(admin, 'finance.creator_support_view'), true);
      assert.equal(hasPermission(admin, 'finance.view_company_revenue'), false); // Owner only!
    });

    it('ADMIN supports namespace wildcards for granted operational permissions', () => {
      const admin = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        permissions: ['community.*'],
      };

      assert.equal(hasPermission(admin, 'community.moderate_comments'), true);
      assert.equal(hasPermission(admin, 'community.manage_strikes'), true);
      assert.equal(hasPermission(admin, 'finance.view_expenses'), false);
    });

    it('Suspended or restricted accounts cannot perform privileged operations', () => {
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

      assert.equal(hasPermission(suspendedAdmin, 'creator_support.view'), false);
      assert.equal(hasPermission(restrictedAdmin, 'creator_support.view'), false);
      assert.equal(hasPermission(suspendedPositionAdmin, 'creator_support.view'), false);

      const vacantPositionAdmin = {
        role: 'ADMIN',
        status: 'GOOD_STANDING',
        positionStatus: 'VACANT',
        permissions: ['creator_support.view'],
      };
      assert.equal(hasPermission(vacantPositionAdmin, 'creator_support.view'), false);
    });

    it('Ordinary USER accounts have no administrative or creator-support permissions', () => {
      const user = {
        role: 'USER',
        status: 'GOOD_STANDING',
      };
      const viewer = {
        role: 'VIEWER',
        status: 'GOOD_STANDING',
      };

      assert.equal(hasPermission(user, 'creator_support.view'), false);
      assert.equal(hasPermission(viewer, 'reports.view'), false);
      assert.equal(hasPermission(user, 'platform.view_health'), false);
    });
  });

  describe('Admin Invitation & Token Security', () => {
    it('Token hashing is deterministic and irreversible using sha256', () => {
      const rawToken = '68c838e4a9b6c4b2671e21b71d604b3917a1e0b5ff9d443216898f7e2d9370ce';
      const hash1 = hashToken(rawToken);
      const hash2 = hashToken(rawToken);

      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64);
      assert.notEqual(rawToken, hash1);
    });

    it('Owner-only permissions cannot be passed into invitation customPermissions', () => {
      const requestedPermissions = [
        'creator_support.view',
        'monetization.view',
        'admins.manage',
        'finance.view_company_revenue',
        'security.manage_policies',
      ];

      const safePermissions = requestedPermissions.filter(
        (perm) => !(OWNER_ONLY_PERMISSIONS as readonly string[]).includes(perm),
      );

      assert.deepEqual(safePermissions, ['creator_support.view', 'monetization.view']);
      assert.equal(safePermissions.includes('admins.manage'), false);
      assert.equal(safePermissions.includes('finance.view_company_revenue'), false);
    });
  });

  describe('Audit Log Sanitization & Security', () => {
    it('Redacts sensitive credentials, tokens, and PII from audit metadata', () => {
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

      const sanitized = sanitizeAuditMetadata(sensitiveInput) as Record<string, any>;

      assert.equal(sanitized.email, 'partner@example.com');
      assert.equal(sanitized.positionNumber, 1);
      assert.equal(sanitized.password, '[REDACTED]');
      assert.equal(sanitized.passwordHash, '[REDACTED]');
      assert.equal(sanitized.token, '[REDACTED]');
      assert.equal(sanitized.secret, '[REDACTED]');
      assert.equal(sanitized.authorization, '[REDACTED]');
      assert.equal(sanitized.cookie, '[REDACTED]');
      assert.equal(sanitized.taxId, '[REDACTED]');
      assert.equal(sanitized.nationalId, '[REDACTED]');
      assert.equal(sanitized.passport, '[REDACTED]');
      assert.equal(sanitized.nested.key, '[REDACTED]');
      assert.equal(sanitized.nested.safeField, 'safe-value');
    });

    it('Leaves non-object primitive metadata untouched', () => {
      assert.equal(sanitizeAuditMetadata(null), null);
      assert.equal(sanitizeAuditMetadata(undefined), null);
      assert.equal(sanitizeAuditMetadata('simple-string'), 'simple-string');
      assert.equal(sanitizeAuditMetadata(12345), 12345);
    });
  });
});
