import { Response, NextFunction } from 'express';
import { db as prisma } from '@watchtube/database';
import { AuthRequest } from './auth';
import { hasPermission, Permission, OWNER_ONLY_PERMISSIONS } from '../security/permissions';

export { requireSuperAdmin, requireAdmin, requireAdministrator } from './admin';

/**
 * Express middleware enforcing scoped backend permissions.
 * Prevents unauthorized privilege escalation and ensures strict owner-only protection.
 */
export const requirePermission = (permission: Permission) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fast-path: SUPER_ADMIN has full authority across all platform features
    if (req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    // If an ordinary admin/moderator tries to access strictly owner-only capabilities, fail fast
    if ((OWNER_ONLY_PERMISSIONS as readonly string[]).includes(permission)) {
      return res.status(403).json({
        error: 'Forbidden. This action is strictly reserved for the SUPER_ADMIN (Owner/CEO).',
      });
    }

    if (req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
      return res.status(403).json({
        error: 'Forbidden. Administrative privileges required.',
      });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          role: true,
          status: true,
          adminPosition: {
            select: {
              status: true,
              permissions: true,
            },
          },
        },
      });

      if (!user) {
        return res.status(403).json({ error: 'Forbidden. User account not found.' });
      }

      if (user.status === 'RESTRICTED' || user.status === 'SUSPENDED') {
        return res.status(403).json({ error: 'Account access is restricted or suspended.' });
      }

      const allowed = hasPermission(
        {
          role: user.role,
          status: user.status,
          permissions: user.adminPosition?.permissions ?? [],
          positionStatus: user.adminPosition?.status,
        },
        permission,
      );

      if (!allowed) {
        return res.status(403).json({
          error: `Forbidden. You do not have permission '${permission}' to perform this action.`,
        });
      }

      next();
    } catch (error) {
      console.error('[RBAC] Permission check error:', error);
      return res.status(500).json({ error: 'Authorization verification failed.' });
    }
  };
};
