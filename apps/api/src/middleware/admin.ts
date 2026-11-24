import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN' && req.user.role !== 'MODERATOR') {
    return res.status(403).json({ error: 'Forbidden. Admin or Moderator access required.' });
  }

  next();
};

export const requireAdministrator = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Administrator access required.' });
  }

  next();
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden. SUPER_ADMIN (Owner/CEO) access required.' });
  }

  next();
};
