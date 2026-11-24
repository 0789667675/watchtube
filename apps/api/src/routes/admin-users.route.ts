import crypto from 'node:crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { recordAuditEvent } from '../services/audit.service';
import { emitPlatformEvent } from '../services/notifications';

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const suspendBodySchema = z.object({
  reason: z.string().trim().min(3, 'A suspension reason of at least 3 characters is required.'),
});

const reinstateBodySchema = z.object({
  reason: z.string().trim().optional(),
});

/**
 * GET /api/v1/admin/users
 * Search and filter users by status, role, and keyword.
 * NEVER returns passwordHash or secret credentials.
 */
router.get('/', requirePermission('users.view'), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const skip = (page - 1) * limit;

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
    const status = typeof req.query.status === 'string' && ['GOOD_STANDING', 'WARNING', 'RESTRICTED', 'SUSPENDED'].includes(req.query.status)
      ? (req.query.status as any)
      : undefined;
    const role = typeof req.query.role === 'string' && ['USER', 'VIEWER', 'CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(req.query.role)
      ? (req.query.role as any)
      : undefined;

    const where: any = {};
    if (status) where.status = status;
    if (role) where.role = role;

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        {
          channels: {
            some: {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { handle: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          channels: {
            select: {
              id: true,
              name: true,
              handle: true,
              avatarUrl: true,
              isVerified: true,
              isMonetized: true,
              subscriberCount: true,
            },
          },
          _count: {
            select: {
              strikes: true,
              reports: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.status(200).json({
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error('[AdminUsers] Error listing users:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

/**
 * GET /api/v1/admin/users/:id
 * Get full user detail including channels, strikes, and recent support cases.
 * Strictly excludes passwordHash.
 */
router.get('/:id', requirePermission('users.view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid user ID format.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        channels: {
          select: {
            id: true,
            name: true,
            handle: true,
            avatarUrl: true,
            bannerUrl: true,
            description: true,
            isVerified: true,
            isMonetized: true,
            subscriberCount: true,
            createdAt: true,
          },
        },
        strikes: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            reason: true,
            strikeType: true,
            expiresAt: true,
            createdAt: true,
          },
        },
        userSupportCases: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            caseReference: true,
            title: true,
            status: true,
            priority: true,
            category: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            strikes: true,
            reports: true,
            channels: true,
            comments: true,
            likes: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error(`[AdminUsers] Error retrieving user ${id}:`, error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

/**
 * POST /api/v1/admin/users/:id/suspend
 * Consequential action: Suspends a user account with a mandatory reason.
 * Invariants:
 *  - Administrator cannot suspend themselves (400)
 *  - Super Administrator accounts cannot be suspended (403)
 *  - User already suspended cannot be re-suspended (400)
 *  - Fully audited with actor and reason
 *  - Dispatches security alert event
 */
router.post('/:id/suspend', requirePermission('users.suspend'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid user ID format.' });
  }

  const parsed = suspendBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'A valid suspension reason is required.',
    });
  }
  const { reason } = parsed.data;

  // Invariant 1: Self-suspension guard
  if (req.user?.id === id) {
    return res.status(400).json({ error: 'Administrators cannot suspend their own account.' });
  }

  try {
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Invariant 2: Super Admin suspension guard
    if (targetUser.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Super Administrator accounts cannot be suspended.' });
    }

    // Invariant 3: Already suspended guard
    if (targetUser.status === 'SUSPENDED') {
      return res.status(400).json({ error: 'User account is already suspended.' });
    }

    await prisma.user.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    if (req.user?.id) {
      await recordAuditEvent({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'USER_SUSPENDED',
        targetResource: 'USER',
        targetId: id,
        outcome: 'SUCCESS',
        metadata: {
          reason,
          previousStatus: targetUser.status,
          targetEmail: targetUser.email,
        },
        req,
      });
    }

    void emitPlatformEvent({
      eventId: crypto.randomUUID(),
      eventType: 'ACCOUNT_SECURITY_ALERT',
      userId: id,
      title: 'Account Suspended',
      details: `Your WatchTube account has been suspended by an administrator. Reason: ${reason}`,
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'User account suspended successfully.',
      userId: id,
      status: 'SUSPENDED',
    });
  } catch (error) {
    console.error(`[AdminUsers] Error suspending user ${id}:`, error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

/**
 * POST /api/v1/admin/users/:id/reinstate
 * Consequential action: Reinstates a suspended user account back to GOOD_STANDING.
 * Invariants:
 *  - User must currently be suspended (400)
 *  - Fully audited with actor and reason
 *  - Dispatches security alert event
 */
router.post('/:id/reinstate', requirePermission('users.suspend'), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid user ID format.' });
  }

  const parsed = reinstateBodySchema.safeParse(req.body);
  const reason = parsed.success ? parsed.data.reason || 'Account reinstated by administrator.' : 'Account reinstated by administrator.';

  try {
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (targetUser.status !== 'SUSPENDED') {
      return res.status(400).json({ error: 'User account is not currently suspended.' });
    }

    await prisma.user.update({
      where: { id },
      data: { status: 'GOOD_STANDING' },
    });

    if (req.user?.id) {
      await recordAuditEvent({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'USER_REINSTATED',
        targetResource: 'USER',
        targetId: id,
        outcome: 'SUCCESS',
        metadata: {
          reason,
          previousStatus: targetUser.status,
          targetEmail: targetUser.email,
        },
        req,
      });
    }

    void emitPlatformEvent({
      eventId: crypto.randomUUID(),
      eventType: 'ACCOUNT_SECURITY_ALERT',
      userId: id,
      title: 'Account Reinstated',
      details: `Your WatchTube account has been reinstated to good standing.`,
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'User account reinstated successfully.',
      userId: id,
      status: 'GOOD_STANDING',
    });
  } catch (error) {
    console.error(`[AdminUsers] Error reinstating user ${id}:`, error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

/**
 * GET /api/v1/admin/users/:id/strikes
 * List community and copyright strikes for a specific user.
 */
router.get('/:id/strikes', requirePermission('users.view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid user ID format.' });
  }

  try {
    const strikes = await prisma.userStrike.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(strikes);
  } catch (error) {
    console.error(`[AdminUsers] Error retrieving strikes for user ${id}:`, error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

/**
 * GET /api/v1/admin/users/:id/reports
 * List reports filed by or filed against this user.
 */
router.get('/:id/reports', requirePermission('reports.view'), async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'Invalid user ID format.' });
  }

  try {
    const userChannels = await prisma.channel.findMany({
      where: { userId: id },
      select: { id: true, videos: { select: { id: true } } },
    });

    const channelIds = userChannels.map((c) => c.id);
    const videoIds = userChannels.flatMap((c) => c.videos.map((v) => v.id));

    const reports = await prisma.report.findMany({
      where: {
        OR: [
          { reporterId: id },
          ...(channelIds.length > 0 ? [{ targetId: { in: channelIds } }] : []),
          ...(videoIds.length > 0 ? [{ targetId: { in: videoIds } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        reporter: {
          select: { id: true, email: true },
        },
      },
    });

    res.status(200).json(reports);
  } catch (error) {
    console.error(`[AdminUsers] Error retrieving reports for user ${id}:`, error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

export { router as adminUsersRouter };
