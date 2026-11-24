"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePermission = exports.requireAdministrator = exports.requireAdmin = exports.requireSuperAdmin = void 0;
const database_1 = require("@watchtube/database");
const permissions_1 = require("../security/permissions");
var admin_1 = require("./admin");
Object.defineProperty(exports, "requireSuperAdmin", { enumerable: true, get: function () { return admin_1.requireSuperAdmin; } });
Object.defineProperty(exports, "requireAdmin", { enumerable: true, get: function () { return admin_1.requireAdmin; } });
Object.defineProperty(exports, "requireAdministrator", { enumerable: true, get: function () { return admin_1.requireAdministrator; } });
/**
 * Express middleware enforcing scoped backend permissions.
 * Prevents unauthorized privilege escalation and ensures strict owner-only protection.
 */
const requirePermission = (permission) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // Fast-path: SUPER_ADMIN has full authority across all platform features
        if (req.user.role === 'SUPER_ADMIN') {
            return next();
        }
        // If an ordinary admin/moderator tries to access strictly owner-only capabilities, fail fast
        if (permissions_1.OWNER_ONLY_PERMISSIONS.includes(permission)) {
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
            const user = await database_1.db.user.findUnique({
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
            const allowed = (0, permissions_1.hasPermission)({
                role: user.role,
                status: user.status,
                permissions: user.adminPosition?.permissions ?? [],
                positionStatus: user.adminPosition?.status,
            }, permission);
            if (!allowed) {
                return res.status(403).json({
                    error: `Forbidden. You do not have permission '${permission}' to perform this action.`,
                });
            }
            next();
        }
        catch (error) {
            console.error('[RBAC] Permission check error:', error);
            return res.status(500).json({ error: 'Authorization verification failed.' });
        }
    };
};
exports.requirePermission = requirePermission;
