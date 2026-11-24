import express, { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import {
  listSupportCases,
  getSupportCaseById,
  createSupportCase,
  assignSupportCase,
  updateSupportCaseStatus,
  escalateSupportCase,
  addCaseNote,
} from '../services/supportCase.service';

const router = express.Router();

// List support cases: requires creator_support.view
router.get('/', requirePermission('creator_support.view'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 25;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const assignedAdminId = typeof req.query.assignedAdminId === 'string' ? req.query.assignedAdminId : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const result = await listSupportCases({
      page,
      limit,
      status,
      priority,
      category,
      assignedAdminId,
      search,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

const createCaseSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(5),
  category: z.enum([
    'ONBOARDING',
    'CHANNEL_ISSUE',
    'STUDIO_SUPPORT',
    'UPLOAD_ISSUE',
    'PROCESSING_FAILURE',
    'METADATA_THUMBNAIL',
    'SUBSCRIPTION_INQUIRY',
    'MONETIZATION_SUPPORT',
    'USER_COMPLAINT',
    'CONTENT_REPORT',
    'PAYOUT_STATUS',
    'OTHER',
  ]).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  channelId: z.string().uuid().optional().nullable(),
  videoId: z.string().uuid().optional().nullable(),
  creatorOrUserId: z.string().uuid().optional().nullable(),
  reporterEmail: z.string().email().optional().nullable(),
  assignedAdminId: z.string().uuid().optional().nullable(),
  assignedPositionNumber: z.number().int().min(1).max(3).optional().nullable(),
});

// Create a support case: requires creator_support.manage
router.post('/', requirePermission('creator_support.manage'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createCaseSchema.parse(req.body);
    const created = await createSupportCase(parsed, {
      id: req.user!.id,
      role: req.user!.role,
    });
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid support case parameters.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create case.' });
  }
});

// Get case details by ID: requires creator_support.view
router.get('/:id', requirePermission('creator_support.view'), async (req: AuthRequest, res: Response) => {
  try {
    const supportCase = await getSupportCaseById(req.params.id);
    if (!supportCase) {
      res.status(404).json({ error: 'Support case not found.' });
      return;
    }
    res.status(200).json(supportCase);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

const assignSchema = z.object({
  assignedAdminId: z.string().uuid(),
  assignedPositionNumber: z.number().int().min(1).max(3).optional(),
});

// Assign or reassign case: requires creator_support.assign
router.post('/:id/assign', requirePermission('creator_support.assign'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = assignSchema.parse(req.body);
    const updated = await assignSupportCase(
      req.params.id,
      parsed,
      { id: req.user!.id, role: req.user!.role },
    );
    res.status(200).json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid assignment parameters.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to assign case.' });
  }
});

const statusSchema = z.object({
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_USER', 'ESCALATED', 'RESOLVED', 'CLOSED']),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  resolutionNotes: z.string().optional(),
});

// Update case status / resolve: requires creator_support.resolve
router.patch('/:id/status', requirePermission('creator_support.resolve'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = statusSchema.parse(req.body);
    const updated = await updateSupportCaseStatus(
      req.params.id,
      parsed,
      { id: req.user!.id, role: req.user!.role },
    );
    res.status(200).json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid status update parameters.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update case status.' });
  }
});

const escalateSchema = z.object({
  escalationReason: z.string().min(5),
});

// Escalate case to SUPER_ADMIN: requires creator_support.manage
router.post('/:id/escalate', requirePermission('creator_support.manage'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = escalateSchema.parse(req.body);
    const updated = await escalateSupportCase(
      req.params.id,
      parsed,
      { id: req.user!.id, role: req.user!.role },
    );
    res.status(200).json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Escalation reason must be at least 5 characters.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to escalate case.' });
  }
});

const noteSchema = z.object({
  content: z.string().min(1),
  isInternal: z.boolean().optional(),
});

// Add note to case: requires creator_support.manage
router.post('/:id/notes', requirePermission('creator_support.manage'), async (req: AuthRequest, res: Response) => {
  try {
    const parsed = noteSchema.parse(req.body);
    const note = await addCaseNote(
      req.params.id,
      parsed,
      { id: req.user!.id, role: req.user!.role },
    );
    res.status(201).json(note);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Note content cannot be empty.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to add note.' });
  }
});

export const supportCasesRouter = router;
