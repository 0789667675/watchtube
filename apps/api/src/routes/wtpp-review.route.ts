import express, { Request, Response } from 'express';
import { z } from 'zod';

export type WtppReviewDecision = 'APPROVED' | 'REJECTED';

export interface WtppReviewRepository {
  reviewPendingApplication(input: {
    applicationId: string;
    status: WtppReviewDecision;
    reviewerNotes: string | null;
  }): Promise<unknown | null>;
}

const reviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewerNotes: z.string().trim().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'REJECTED' && !value.reviewerNotes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewerNotes'],
      message: 'A reason is required when rejecting an application.',
    });
  }
});

export function createWtppReviewRouter(repository: WtppReviewRepository): express.Router {
  const router = express.Router();

  router.patch('/:id', async (req: Request, res: Response) => {
    const applicationId = z.string().uuid().safeParse(req.params.id);
    const decision = reviewSchema.safeParse(req.body);
    if (!applicationId.success || !decision.success) {
      res.status(400).json({ error: 'Invalid review decision or missing rejection reason.' });
      return;
    }

    try {
      const application = await repository.reviewPendingApplication({
        applicationId: applicationId.data,
        status: decision.data.status,
        reviewerNotes: decision.data.reviewerNotes || null,
      });
      if (!application) {
        res.status(409).json({ error: 'Only pending applications can be reviewed.' });
        return;
      }
      res.status(200).json(application);
    } catch (error) {
      console.error('WTPP application review failed.', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(500).json({ error: 'Application review is temporarily unavailable.' });
    }
  });

  return router;
}
