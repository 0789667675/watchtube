import express, { Request, RequestHandler, Response, Router } from 'express';
import { db as prisma } from '@watchtube/database';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

export function createAdEventRouter(authenticateMiddleware: RequestHandler): Router {
  const router = Router();

  router.post('/ad-event', authenticateMiddleware, (_req: Request, res: Response) => {
    res.status(501).json({ error: 'Ad event verification is not configured' });
  });

  return router;
}

type AdProviderConfigRecord = Awaited<ReturnType<typeof prisma.adProviderConfig.findMany>>[number];

export function createAdConfigRouter(loadProviders: () => Promise<AdProviderConfigRecord[]>): Router {
  const router = Router();

  router.get('/config', async (_req: Request, res: Response) => {
    try {
      const providers = await loadProviders();
      res.status(200).json({
        enabled: providers.length > 0,
        providers,
        adSkipOffsetSeconds: 5
      });
    } catch (error) {
      console.error('Failed to load monetization config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

export function createRevenueReconciliationRouter(
  authenticateMiddleware: RequestHandler,
  requireAdminMiddleware: RequestHandler
): Router {
  const router = Router();

  router.post('/reconcile', authenticateMiddleware, requireAdminMiddleware, (_req: Request, res: Response) => {
    res.status(501).json({ error: 'Revenue reconciliation is unavailable until verified allocation is configured' });
  });

  return router;
}

const monetizationRouter = express.Router();
monetizationRouter.use(createAdEventRouter(authenticate));
monetizationRouter.use(createAdConfigRouter(() => prisma.adProviderConfig.findMany({
  where: { isEnabled: true },
  orderBy: { priority: 'asc' }
})));
monetizationRouter.use(createRevenueReconciliationRouter(authenticate, requireAdmin));

export { monetizationRouter };
