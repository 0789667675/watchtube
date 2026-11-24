import express, { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { requireSuperAdmin, requireAdmin } from '../middleware/admin';
import {
  getAdminPositions,
  inviteAdmin,
  listAdminInvitations,
  revokeInvitation,
  resendInvitation,
  suspendAdmin,
  restoreAdmin,
  revokeAdminPosition,
  updateAdminPermissions,
} from '../services/adminManagement.service';

const router = express.Router();

// View all three positions: accessible to Admins and SUPER_ADMIN
router.get('/positions', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const positions = await getAdminPositions();
    res.status(200).json(positions);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

const inviteSchema = z.object({
  email: z.string().email(),
  positionNumber: z.number().int().min(1).max(3),
  assignment: z.string().min(3),
  customPermissions: z.array(z.string()).optional(),
});

// Invite partner to an available position: SUPER_ADMIN ONLY
router.post('/invitations', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = inviteSchema.parse(req.body);
    const result = await inviteAdmin({
      email: parsed.email,
      positionNumber: parsed.positionNumber,
      assignment: parsed.assignment,
      customPermissions: parsed.customPermissions,
      invitedById: req.user!.id,
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid invitation request parameters.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to send invitation.' });
  }
});

// List all invitations: SUPER_ADMIN ONLY
router.get('/invitations', requireSuperAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const invitations = await listAdminInvitations();
    res.status(200).json(invitations);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
  }
});

// Revoke a pending invitation: SUPER_ADMIN ONLY
router.post('/invitations/:id/revoke', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const updated = await revokeInvitation(req.params.id, req.user!.id);
    res.status(200).json(updated);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to revoke invitation.' });
  }
});

// Resend an invitation: SUPER_ADMIN ONLY
router.post('/invitations/:id/resend', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await resendInvitation(req.params.id, req.user!.id);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to resend invitation.' });
  }
});

// Suspend an admin position: SUPER_ADMIN ONLY
router.post('/positions/:positionNumber/suspend', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const positionNumber = parseInt(req.params.positionNumber, 10);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = await suspendAdmin(positionNumber, req.user!.id, reason);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to suspend admin.' });
  }
});

// Restore a suspended admin position: SUPER_ADMIN ONLY
router.post('/positions/:positionNumber/restore', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const positionNumber = parseInt(req.params.positionNumber, 10);
    const result = await restoreAdmin(positionNumber, req.user!.id);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to restore admin.' });
  }
});

// Revoke an admin position: SUPER_ADMIN ONLY
router.post('/positions/:positionNumber/revoke', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const positionNumber = parseInt(req.params.positionNumber, 10);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = await revokeAdminPosition(positionNumber, req.user!.id, reason);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to revoke admin.' });
  }
});

const permissionsUpdateSchema = z.object({
  assignment: z.string().min(2),
  permissions: z.array(z.string()),
});

// Update an admin's assignment and custom permissions: SUPER_ADMIN ONLY
router.patch('/positions/:positionNumber/permissions', requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const positionNumber = parseInt(req.params.positionNumber, 10);
    const parsed = permissionsUpdateSchema.parse(req.body);
    const updated = await updateAdminPermissions(
      positionNumber,
      parsed.assignment,
      parsed.permissions,
      req.user!.id,
    );
    res.status(200).json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid permissions update parameters.' });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update permissions.' });
  }
});

export const adminManagementRouter = router;
