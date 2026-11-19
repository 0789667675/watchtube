"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = void 0;
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
        return res.status(403).json({ error: 'Forbidden. Admin or Moderator access required.' });
    }
    next();
};
exports.requireAdmin = requireAdmin;
