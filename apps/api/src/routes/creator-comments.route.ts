import { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { sendDatabaseErrorResponse } from '../config/databaseErrors';

interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

export interface CreatorCommentChannelProfile {
  name: string;
  handle: string;
  avatarUrl: string | null;
}

export interface CreatorCommentRecord {
  id: string;
  content: string;
  parentId: string | null;
  createdAt: Date;
  user: {
    id: string;
    channels: CreatorCommentChannelProfile[];
  };
  video: {
    id: string;
    title: string;
  };
}

export interface CreatorCommentListInput {
  channelId: string;
  userId: string;
  page: number;
  limit: number;
  search?: string;
}

export interface CreatorCommentRepository {
  ownsChannel(channelId: string, userId: string): Promise<boolean>;
  listComments(input: CreatorCommentListInput): Promise<{
    comments: CreatorCommentRecord[];
    total: number;
  }>;
  deleteComment(input: {
    channelId: string;
    commentId: string;
    userId: string;
  }): Promise<boolean>;
}

export interface CreatorCommentsRouteDependencies {
  authenticate: RequestHandler;
  repository: CreatorCommentRepository;
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(200).optional(),
});

function getUserId(req: Request, res: Response): string | undefined {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return undefined;
  }
  return userId;
}

function sendInternalError(res: Response, error: unknown): void {
  console.error('Creator comment moderation request failed.');
  sendDatabaseErrorResponse(
    res,
    error,
    'Creator comments are temporarily unavailable because the database is unavailable.',
  );
}

export function createCreatorCommentsRouter(
  dependencies: CreatorCommentsRouteDependencies,
): Router {
  const router = Router();

  router.get(
    '/channels/:channelId/comments',
    dependencies.authenticate,
    async (req: Request, res: Response) => {
      const userId = getUserId(req, res);
      if (!userId) return;

      const channelId = z.string().uuid().safeParse(req.params.channelId);
      const query = listQuerySchema.safeParse(req.query);
      if (!channelId.success || !query.success) {
        res.status(400).json({ error: 'Invalid comment query' });
        return;
      }

      try {
        if (!(await dependencies.repository.ownsChannel(channelId.data, userId))) {
          res.status(404).json({ error: 'Channel not found' });
          return;
        }

        const { comments, total } = await dependencies.repository.listComments({
          channelId: channelId.data,
          userId,
          page: query.data.page,
          limit: query.data.limit,
          ...(query.data.search ? { search: query.data.search } : {}),
        });
        res.status(200).json({
          comments,
          page: query.data.page,
          limit: query.data.limit,
          total,
          totalPages: Math.ceil(total / query.data.limit),
        });
      } catch (error) {
        sendInternalError(res, error);
      }
    },
  );

  router.delete(
    '/channels/:channelId/comments/:commentId',
    dependencies.authenticate,
    async (req: Request, res: Response) => {
      const userId = getUserId(req, res);
      if (!userId) return;

      const params = z.object({
        channelId: z.string().uuid(),
        commentId: z.string().uuid(),
      }).safeParse(req.params);
      if (!params.success) {
        res.status(400).json({ error: 'Invalid comment request' });
        return;
      }

      try {
        if (!(await dependencies.repository.ownsChannel(params.data.channelId, userId))) {
          res.status(404).json({ error: 'Channel not found' });
          return;
        }

        const deleted = await dependencies.repository.deleteComment({
          channelId: params.data.channelId,
          commentId: params.data.commentId,
          userId,
        });
        if (!deleted) {
          res.status(404).json({ error: 'Comment not found' });
          return;
        }
        res.status(200).json({ deleted: true, commentId: params.data.commentId });
      } catch (error) {
        sendInternalError(res, error);
      }
    },
  );

  return router;
}
