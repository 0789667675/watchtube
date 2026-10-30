import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { generatePresignedUploadUrl, verifyObjectExists } from './services/storage.service';
import { authRouter } from './routes/auth.route';
import { interactionRouter } from './routes/interaction.route';
import { analyticsRouter } from './routes/analytics.route';
import { feedRouter } from './routes/feed.route';
import { studioRouter } from './routes/studio.route';
import { walletRouter } from './routes/wallet.route';
import { trustRouter } from './routes/trust.route';
import { adminRouter } from './routes/admin.route';
import { channelRouter } from './routes/channel.route';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const app = express();
const port = process.env.PORT || 3001;
const prisma = new PrismaClient();

// Setup Redis & BullMQ
const connection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});
const videoQueue = new Queue('video-transcode', { connection });

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// API Router
const apiRouter = express.Router();
apiRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Welcome to WatchTube API v1' });
});

// Video Upload Intent
const uploadIntentSchema = z.object({
  title: z.string().min(1).max(255),
  contentType: z.string(),
  fileSize: z.number().positive(),
  channelId: z.string().uuid(),
});

apiRouter.post('/videos/upload-intent', async (req: Request, res: Response) => {
  try {
    const validatedData = uploadIntentSchema.parse(req.body);

    // In a real application, we would extract the userId from auth middleware
    const mockUserId = '12345678-1234-1234-1234-123456789012';

    const { uploadUrl, fileKey } = await generatePresignedUploadUrl(
      mockUserId,
      validatedData.contentType,
      validatedData.fileSize
    );

    const video = await prisma.video.create({
      data: {
        channelId: validatedData.channelId,
        title: validatedData.title,
        rawStorageKey: fileKey,
        status: 'DRAFT',
      },
    });

    res.status(200).json({
      videoId: video.id,
      uploadUrl,
      fileKey,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      res.status(400).json({ error: error.message });
    }
  }
});

// Verify Upload
apiRouter.post('/videos/:id/verify-upload', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.id;

    const video = await prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    if (video.status !== 'DRAFT') {
      res.status(400).json({ error: 'Video is not in DRAFT status' });
      return;
    }

    const exists = await verifyObjectExists(video.rawStorageKey);

    if (!exists) {
      res.status(400).json({ error: 'File not found in storage' });
      return;
    }

    const updatedVideo = await prisma.video.update({
      where: { id: videoId },
      data: { status: 'PROCESSING' },
    });

    // Enqueue BullMQ job for FFmpeg worker here
    await videoQueue.add('processVideo', {
      videoId: updatedVideo.id,
      rawStorageKey: updatedVideo.rawStorageKey,
    });
    console.log(`[Queue Stub] Enqueueing processing job for video ${videoId}`);

    res.status(200).json({
      message: 'Upload verified and processing started',
      videoId: updatedVideo.id,
      status: updatedVideo.status,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use('/api/v1', apiRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/channels', channelRouter);
app.use('/api/v1', interactionRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/feed', feedRouter);
app.use('/api/v1/studio', studioRouter);
app.use('/api/v1/wallet', walletRouter);
app.use('/api/v1', trustRouter);
app.use('/api/v1/admin', adminRouter);

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});

// Public Video APIs
apiRouter.get('/videos', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 12;
    const category = req.query.category as string;

    const skip = (page - 1) * limit;

    // Example basic where clause, can be expanded to filter by category if added to DB schema
    const whereClause: any = {
      status: 'READY',
      visibility: 'PUBLIC'
    };

    const videos = await prisma.video.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        channel: {
          select: {
            name: true,
            handle: true,
            avatarUrl: true,
            isVerified: true
          }
        }
      }
    });

    res.status(200).json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

apiRouter.get('/videos/:id', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.id;

    const video = await prisma.video.findUnique({
      where: {
        id: videoId,
        status: 'READY'
      },
      include: {
        channel: {
          select: {
            name: true,
            handle: true,
            avatarUrl: true,
            isVerified: true,
            subscriberCount: true
          }
        },
        variants: true
      }
    });

    if (!video) {
      res.status(404).json({ error: 'Video not found or not available' });
      return;
    }

    res.status(200).json(video);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
