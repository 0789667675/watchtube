"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = exports.requireAdministrator = exports.requireAdmin = void 0;
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
        return res.status(403).json({ error: 'Forbidden. Admin or Moderator access required.' });
    }
    next();
};
exports.requireAdmin = requireAdmin;
const requireAdministrator = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Administrator access required.' });
    }
    next();
};
exports.requireAdministrator = requireAdministrator;
const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden. SUPER_ADMIN (Owner/CEO) access required.' });
    }
    next();
};
exports.requireSuperAdmin = requireSuperAdmin;
