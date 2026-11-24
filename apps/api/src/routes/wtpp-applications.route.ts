import express, { Request, Response } from 'express';

export interface WtppAdminApplication {
  id: string;
  channelWatchHours: number;
  subscriberCount: number;
  submittedAt: Date;
  status?: string;
  reviewerNotes?: string | null;
  reviewedAt?: Date | null;
  channel: {
    id?: string;
    name: string;
    handle: string;
    userId?: string;
    createdAt?: Date;
  };
  hasTaxId?: boolean;
  hasNationalId?: boolean;
}

export interface WtppApplicationsRepository {
  listPendingApplications(): Promise<WtppAdminApplication[]>;
  getApplicationById?(id: string): Promise<WtppAdminApplication | null>;
}

export function createWtppApplicationsRouter(
  repository: WtppApplicationsRepository,
): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res: Response) => {
    try {
      const applications = await repository.listPendingApplications();
      res.status(200).json(applications.map((application) => ({
        id: application.id,
        channelWatchHours: application.channelWatchHours,
        subscriberCount: application.subscriberCount,
        submittedAt: application.submittedAt,
        channel: {
          name: application.channel.name,
          handle: application.channel.handle,
        },
      })));
    } catch (error) {
      console.error('WTPP applications listing failed.', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      if (!repository.getApplicationById) {
        res.status(501).json({ error: 'Application lookup not supported.' });
        return;
      }
      const application = await repository.getApplicationById(req.params.id);
      if (!application) {
        res.status(404).json({ error: 'Application not found' });
        return;
      }
      res.status(200).json(application);
    } catch (error) {
      console.error('WTPP application lookup failed.', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
