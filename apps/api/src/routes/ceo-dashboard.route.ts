import express, { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/admin';
import { requirePermission } from '../middleware/rbac';
import {
  getCompanyOverview,
  getAdminOversight,
  getPlatformHealthOverview,
  getOperationalOverview,
  getFinancialIntelligence,
  getCreatorFinancialSummary,
} from '../services/ceoDashboard.service';
import { listAuditLogs } from '../services/audit.service';

const router = express.Router();

// CEO Platform Overview: SUPER_ADMIN ONLY
router.get('/ceo/overview', requireSuperAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const overview = await getCompanyOverview();
    res.status(200).json(overview);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// CEO Admin Oversight: SUPER_ADMIN ONLY
router.get('/ceo/admin-oversight', requireSuperAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const oversight = await getAdminOversight();
    res.status(200).json(oversight);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// CEO Financial Intelligence: SUPER_ADMIN ONLY (Guarded against all non-owners)
router.get('/ceo/financial-intelligence', requireSuperAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const finances = await getFinancialIntelligence();
    res.status(200).json(finances);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Platform operational health: Admins with platform.view_health or SUPER_ADMIN
router.get('/platform/health', requirePermission('platform.view_health'), async (_req: AuthRequest, res: Response) => {
  try {
    const health = await getPlatformHealthOverview(true);
    res.status(200).json(health);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Platform operational overview: Admins with platform.view_health or SUPER_ADMIN
router.get('/operational-overview', requirePermission('platform.view_health'), async (_req: AuthRequest, res: Response) => {
  try {
    const overview = await getOperationalOverview();
    res.status(200).json(overview);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Limited Creator-Specific Financial Support:
// Authorized Admins can check a specific channel's balance/transactions for customer support
// without revealing total platform revenue, provider fees, or other creators' numbers.
router.get(
  '/creator-support/channels/:channelId/financial-summary',
  requirePermission('finance.creator_support_view'),
  async (req: AuthRequest, res: Response) => {
    try {
      const summary = await getCreatorFinancialSummary(req.params.channelId);
      res.status(200).json(summary);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : 'Channel financial details not found.' });
    }
  },
);

// Audit logs:
// SUPER_ADMIN sees all; ordinary Admins with audit.view_operational see operational logs only.
router.get('/audit-logs', requirePermission('audit.view_operational'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const skip = (Math.max(1, page) - 1) * Math.min(limit, 100);
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const targetResource = typeof req.query.targetResource === 'string' ? req.query.targetResource : undefined;
    const outcome = typeof req.query.outcome === 'string' && ['SUCCESS', 'FAILED', 'DENIED'].includes(req.query.outcome)
      ? (req.query.outcome as 'SUCCESS' | 'FAILED' | 'DENIED')
      : undefined;
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;

    const isSuperAdmin = req.user!.role === 'SUPER_ADMIN';

    const result = await listAuditLogs({
      skip,
      limit,
      action,
      targetResource,
      outcome,
      startDate,
      endDate,
      operationalOnly: !isSuperAdmin,
    });

    res.status(200).json({
      ...result,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit) || 1,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

export const ceoDashboardRouter = router;
