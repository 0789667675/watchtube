import express, { Request, RequestHandler, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';
import { JWT_SECRET } from '../config/jwt';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const ADMIN_POSITION_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MODERATOR']);

export interface AuthRouterOptions {
  prismaClient?: any;
  authenticateMiddleware?: RequestHandler;
}

export function createAuthRouter(options: AuthRouterOptions = {}): express.Router {
  const router = express.Router();
  const dbClient = options.prismaClient ?? prisma;
  const authMiddleware = options.authenticateMiddleware ?? authenticate;

  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { email, password } = registerSchema.parse(req.body);

      const existing = await dbClient.user.findUnique({ where: { email } });
      if (existing) {
        res.status(400).json({ error: 'Email in use' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await dbClient.user.create({
        data: { email, passwordHash, status: 'GOOD_STANDING' }
      });

      res.status(201).json({ id: user.id, email: user.email });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request' });
        return;
      }
      sendDatabaseErrorResponse(
        res,
        error,
        'Registration is temporarily unavailable because the database is unavailable.',
      );
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = registerSchema.parse(req.body);
      const user = await dbClient.user.findUnique({ where: { email } });

      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid request' });
        return;
      }
      sendDatabaseErrorResponse(
        res,
        error,
        'Sign-in is temporarily unavailable because the database is unavailable.',
      );
    }
  });

  router.post('/logout', (req: Request, res: Response) => {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
    });
    res.status(200).json({ success: true });
  });

  router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const user = await dbClient.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          channels: {
            select: {
              id: true,
              name: true,
              handle: true,
              description: true,
              avatarUrl: true,
              bannerUrl: true,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      });
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      let adminPosition: {
        positionNumber: number;
        assignment: string | null;
        permissions: string[];
        status: string;
      } | null = null;

      if (ADMIN_POSITION_ROLES.has(user.role) && typeof dbClient.adminPosition?.findUnique === 'function') {
        adminPosition = await dbClient.adminPosition.findUnique({
          where: { userId: user.id },
          select: {
            positionNumber: true,
            assignment: true,
            permissions: true,
            status: true,
          },
        });
      }

      const responseData = {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        channels: user.channels,
        positionNumber: adminPosition?.positionNumber ?? null,
        assignment: adminPosition?.assignment ?? null,
        permissions: user.role === 'SUPER_ADMIN'
          ? ['*']
          : adminPosition?.status === 'OCCUPIED'
            ? adminPosition.permissions ?? []
            : [],
      };
      res.status(200).json(responseData);
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Account details are temporarily unavailable because the database is unavailable.',
      );
    }
  });

  return router;
}

const authRouter = createAuthRouter();

export { authRouter };
