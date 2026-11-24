import express, { Request, Response } from 'express';
import { z } from 'zod';
import { verifyInvitationToken, acceptInvitation } from '../services/adminManagement.service';
import { isDatabaseUnavailable, sendDatabaseErrorResponse } from '../config/databaseErrors';

export interface InvitationPublicService {
  verifyInvitationToken(token: string): Promise<{ valid: boolean; error?: string; invitation?: any }>;
  acceptInvitation(input: { token: string; password: string }): Promise<any>;
}

export function createInvitationPublicRouter(
  service: InvitationPublicService = {
    verifyInvitationToken,
    acceptInvitation,
  },
) {
  const router = express.Router();

  // Verify invitation token (public)
  router.get('/verify/:token', async (req: Request, res: Response) => {
    try {
      const token = req.params.token;
      if (!token) {
        res.status(400).json({ error: 'Token is required.' });
        return;
      }

      const verification = await service.verifyInvitationToken(token);
      if (!verification.valid) {
        res.status(400).json({ error: verification.error });
        return;
      }

      res.status(200).json(verification.invitation);
    } catch (error) {
      sendDatabaseErrorResponse(
        res,
        error,
        'Invitation verification is temporarily unavailable because the database is unavailable.',
      );
    }
  });

  const acceptSchema = z.object({
    token: z.string().min(16),
    password: z.string().min(8),
  });

  // Accept invitation and establish individual admin account (public)
  router.post('/accept', async (req: Request, res: Response) => {
    try {
      const { token, password } = acceptSchema.parse(req.body);
      const result = await service.acceptInvitation({ token, password });
      res.status(200).json({
        success: true,
        message: 'Invitation accepted successfully. You may now log in to the Admin Portal.',
        account: {
          userId: result.userId,
          email: result.email,
          positionNumber: result.positionNumber,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }
      if (isDatabaseUnavailable(error)) {
        sendDatabaseErrorResponse(
          res,
          error,
          'Invitation acceptance is temporarily unavailable because the database is unavailable.',
        );
        return;
      }
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to accept invitation.' });
    }
  });

  return router;
}

export const invitationPublicRouter = createInvitationPublicRouter();
