import { Request, Response, Router } from 'express';

export interface HealthRouterDependencies {
  databaseConfigured: boolean;
  checkDatabase(): Promise<void>;
  getRedisStatus(): string;
  getStorageStatus(): { status: string; missing: string[] };
}

export function createHealthRouter(dependencies: HealthRouterDependencies): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    let databaseStatus = 'unconfigured';
    if (dependencies.databaseConfigured) {
      try {
        await dependencies.checkDatabase();
        databaseStatus = 'connected';
      } catch {
        databaseStatus = 'unavailable';
      }
    }

    const storage = dependencies.getStorageStatus();
    const redisStatus = dependencies.getRedisStatus();
    const ready = databaseStatus === 'connected';
    res.status(ready ? 200 : 503).json({
      status: ready
        ? redisStatus === 'connected' && storage.status === 'configured'
          ? 'ready'
          : 'degraded'
        : 'degraded',
      services: {
        database: databaseStatus,
        redis: redisStatus,
        storage,
      },
    });
  });

  return router;
}
