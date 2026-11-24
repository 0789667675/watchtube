import express, { Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { formatRateBasisPoints, ratePercentToBasisPoints } from '../services/shortsMonetization';

export interface ShortsMonetizationSettingRecord {
  rateBasisPoints: number;
  updatedAt: Date;
  updatedById: string | null;
}

export interface ShortsMonetizationRateChangeRecord {
  id: string;
  actorId: string;
  previousRateBasisPoints: number;
  newRateBasisPoints: number;
  changedAt: Date;
}

export interface ShortsMonetizationAdminRepository {
  findSetting(): Promise<ShortsMonetizationSettingRecord | null>;
  listRateChanges(limit: number): Promise<ShortsMonetizationRateChangeRecord[]>;
  updateRate(input: {
    actorId: string;
    newRateBasisPoints: number;
  }): Promise<{
    setting: ShortsMonetizationSettingRecord;
    change: ShortsMonetizationRateChangeRecord | null;
  } | null>;
  onRateChanged?: (event: {
    actorId: string;
    actorRole: string;
    change: ShortsMonetizationRateChangeRecord;
    req: Request;
  }) => Promise<void> | void;
}

const updateRateSchema = z.object({
  ratePercent: z.string(),
});

function serializeRateChange(change: ShortsMonetizationRateChangeRecord) {
  return {
    id: change.id,
    actorId: change.actorId,
    previousRatePercent: formatRateBasisPoints(change.previousRateBasisPoints),
    newRatePercent: formatRateBasisPoints(change.newRateBasisPoints),
    changedAt: change.changedAt.toISOString(),
  };
}

function serializeSetting(setting: ShortsMonetizationSettingRecord) {
  return {
    ratePercent: formatRateBasisPoints(setting.rateBasisPoints),
    updatedAt: setting.updatedAt.toISOString(),
    updatedById: setting.updatedById,
  };
}

export function createShortsMonetizationAdminRouter(
  requireAdministratorMiddleware: express.RequestHandler,
  repository: ShortsMonetizationAdminRepository,
): express.Router {
  const router = express.Router();
  router.use(requireAdministratorMiddleware);

  router.get('/shorts-rate', async (_req: Request, res: Response) => {
    try {
      const [setting, history] = await Promise.all([
        repository.findSetting(),
        repository.listRateChanges(50),
      ]);
      if (!setting) {
        return res.status(503).json({ error: 'Shorts monetization settings are unavailable.' });
      }

      return res.status(200).json({
        ...serializeSetting(setting),
        history: history.map(serializeRateChange),
      });
    } catch (error) {
      console.error('Failed to load Shorts monetization settings:', error);
      return res.status(503).json({ error: 'Shorts monetization settings are unavailable.' });
    }
  });

  router.put('/shorts-rate', async (req: Request, res: Response) => {
    const parsedBody = updateRateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Enter a percentage with up to two decimal places.' });
    }

    const rateBasisPoints = ratePercentToBasisPoints(parsedBody.data.ratePercent);
    if (rateBasisPoints === null) {
      return res.status(400).json({ error: 'Rate must be between 0.00% and 100.00%.' });
    }

    const actor = (req as AuthRequest).user;
    if (!actor?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const result = await repository.updateRate({ actorId: actor.id, newRateBasisPoints: rateBasisPoints });
      if (!result) {
        return res.status(409).json({ error: 'The rate changed concurrently. Reload and try again.' });
      }

      if (result.change && repository.onRateChanged) {
        await repository.onRateChanged({
          actorId: actor.id,
          actorRole: actor.role || 'SUPER_ADMIN',
          change: result.change,
          req,
        });
      }

      return res.status(200).json({
        ...serializeSetting(result.setting),
        change: result.change ? serializeRateChange(result.change) : null,
      });
    } catch (error) {
      console.error('Failed to update Shorts monetization rate:', error);
      return res.status(503).json({ error: 'Shorts monetization rate could not be saved.' });
    }
  });

  return router;
}
