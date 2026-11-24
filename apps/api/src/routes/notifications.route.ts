import { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { NotificationService } from '../services/notifications';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';

interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

function getUserId(req: Request, res: Response): string | undefined {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return undefined;
  }
  return userId;
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  unreadOnly: z.enum(['true', 'false', '1', '0']).optional().transform((v) => v === 'true' || v === '1'),
});

const updatePreferencesSchema = z.object({
  emailSecurityAlerts: z.boolean().optional(),
  emailFinancialTransfers: z.boolean().optional(),
  emailWtppUpdates: z.boolean().optional(),
  emailVideoProcessing: z.boolean().optional(),
  emailPlatformAnnouncements: z.boolean().optional(),
  inAppFinancialAlerts: z.boolean().optional(),
  inAppVideoProcessing: z.boolean().optional(),
  inAppPlatformAnnouncements: z.boolean().optional(),
}).strict();

export interface NotificationRouterDependencies {
  authenticate: RequestHandler;
  notificationService: NotificationService;
}

export function createNotificationRouter(dependencies: NotificationRouterDependencies): Router {
  const router = Router();
  const { authenticate, notificationService } = dependencies;

  router.use(authenticate);

  router.get('/', async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
      return;
    }

    try {
      const result = await notificationService.listNotifications(userId, parsed.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      sendDatabaseErrorResponse(res, err, 'Notification service temporarily unavailable.');
    }
  });

  router.get('/preferences', async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    try {
      const preferences = await notificationService.getPreferences(userId);
      res.status(200).json(preferences);
    } catch (err: unknown) {
      sendDatabaseErrorResponse(res, err, 'Notification preferences temporarily unavailable.');
    }
  });

  router.patch('/preferences', async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const parsed = updatePreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid preferences payload', details: parsed.error.issues });
      return;
    }

    try {
      // Security alert preferences can NEVER be disabled by the user or creator
      const sanitized = {
        ...parsed.data,
        emailSecurityAlerts: true,
      };
      const preferences = await notificationService.updatePreferences(userId, sanitized);
      res.status(200).json(preferences);
    } catch (err: unknown) {
      sendDatabaseErrorResponse(res, err, 'Could not update notification preferences.');
    }
  });

  router.get('/unread-count', async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    try {
      const unreadCount = await notificationService.getUnreadCount(userId);
      res.status(200).json({ unreadCount });
    } catch (err: unknown) {
      sendDatabaseErrorResponse(res, err, 'Notification count temporarily unavailable.');
    }
  });

  router.patch('/:id/read', async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    const id = req.params.id;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'Invalid notification ID' });
      return;
    }

    try {
      const updated = await notificationService.markAsRead(userId, id);
      if (!updated) {
        res.status(404).json({ error: 'Notification not found' });
        return;
      }
      res.status(200).json(updated);
    } catch (err: unknown) {
      sendDatabaseErrorResponse(res, err, 'Could not update notification.');
    }
  });

  router.post('/read-all', async (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;

    try {
      const result = await notificationService.markAllAsRead(userId);
      res.status(200).json(result);
    } catch (err: unknown) {
      sendDatabaseErrorResponse(res, err, 'Could not mark notifications as read.');
    }
  });

  return router;
}
