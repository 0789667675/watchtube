import express, { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { requireSuperAdmin } from '../middleware/admin';
import {
  createApprovalRequest,
  listApprovalRequests,
  reviewApprovalRequest,
} from '../services/approvalRequest.service';

const router = express.Router();

// List approval requests: Admins see their own; SUPER_ADMIN sees all
router.get('/', requirePermission('approvals.create'), async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const requests = await listApprovalRequests(
      { id: req.user!.id, role: req.user!.role },
      status,
    );
    res.status(200).json(requests);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

const createApprovalSchema = z.object({
  type: z.enum([
    'GLOBAL_MONETIZATION_CHANGE',
    'FINANCIAL_ADJUSTMENT',
    'SECURITY_POLICY_CHANGE',
    'PLATFORM_CONFIG_CHANGE',
    'OTHER',
  ]),
  title: z.string().min(3),
  description: z.string().min(5),
  payload: z.any().optional(),
});

// Submit a new approval request: requires approvals.create
router.post('/', requirePermission('approvals.create'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createApprovalSchema.parse(req.body);
    const request = await createApprovalRequest({
      ...parsed,
      requesterId: req.user!.id,
    });
    res.status(201).json(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid approval request parameters.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to submit approval request.' });
  }
});

const reviewApprovalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewerNotes: z.string().optional(),
});

// Review / decide on approval request: SUPER_ADMIN ONLY
router.post('/:id/review', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = reviewApprovalSchema.parse(req.body);
    const updated = await reviewApprovalRequest(
      req.params.id,
      parsed,
      { id: req.user!.id, role: req.user!.role },
    );
    res.status(200).json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid review decision.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to review request.' });
  }
});

export const approvalRequestsRouter = router;
