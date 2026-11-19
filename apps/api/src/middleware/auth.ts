import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '@watchtube/database';

import { JWT_SECRET } from '../config/jwt';
import { isDatabaseUnavailable } from '../config/databaseErrors';

export interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

export interface AuthenticatedUser {
  id: string;
  role: string;
  status: 'GOOD_STANDING' | 'WARNING' | 'RESTRICTED' | 'SUSPENDED';
}

export function createAuthenticate(
  findUser: (id: string) => Promise<AuthenticatedUser | null>,
): RequestHandler {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let userId: string;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (typeof decoded === 'string' || typeof decoded.id !== 'string') {
        res.status(401).json({ error: 'Invalid token' });
        return;
      }
      userId = decoded.id;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    let user: AuthenticatedUser | null;
    try {
      user = await findUser(userId);
    } catch (error) {
      console.error(`[API] Authentication user lookup failed${isDatabaseUnavailable(error) ? ' because the database is unavailable.' : '.'}`);
      const message = isDatabaseUnavailable(error)
        ? 'Authentication is temporarily unavailable because the database is unavailable'
        : 'Authentication is temporarily unavailable';
      res.status(503).json({ error: message });
      return;
    }

    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (user.status === 'RESTRICTED' || user.status === 'SUSPENDED') {
      res.status(403).json({ error: 'Account access is restricted' });
      return;
    }

    req.user = { id: user.id, role: user.role };
    next();
  };
}

export const authenticate = createAuthenticate(async (id) => db.user.findUnique({
  where: { id },
  select: { id: true, role: true, status: true },
}));
