import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@watchtube/database';
import { generatePresignedUploadUrl, inspectRawObject } from './services/storage.service';
import { authRouter } from './routes/auth.route';
import { interactionRouter } from './routes/interaction.route';
import { analyticsRouter } from './routes/analytics.route';
import { feedRouter } from './routes/feed.route';
import { studioRouter } from './routes/studio.route';
import { walletRouter } from './routes/wallet.route';
import { trustRouter } from './routes/trust.route';
import { adminRouter } from './routes/admin.route';
import { monetizationRouter } from './routes/monetization.route';
import { channelRouter } from './routes/channel.route';
import { authenticate } from './middleware/auth';
import { createVideoUploadRouter } from './routes/video-upload.route';
import { createCorsMiddleware, parseAllowedOrigins } from './middleware/cors';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { JWT_SECRET } from './config/jwt';

const app = express();
const port = process.env.PORT || 3001;
const prisma = new PrismaClient();

// Setup Redis & BullMQ
const connection = process.env.REDIS_URL
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
    });
const videoQueue = new Queue('video-transcode', { connection });

const allowedOrigins = parseAllowedOrigins(process.env.API_ALLOWED_ORIGINS, process.env.NODE_ENV === 'production');
app.use(createCorsMiddleware(allowedOrigins));

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

const videoUploadRouter = createVideoUploadRouter({
  authenticate,
  repository: {
    async ownsChannel(channelId, userId) {
      return Boolean(await prisma.channel.findFirst({
        where: { id: channelId, userId },
        select: { id: true },
      }));
    },
    async createVideo(data) {
      return prisma.video.create({ data });
    },
    async findVideo(videoId) {
      return prisma.video.findUnique({
        where: { id: videoId },
        include: { channel: { select: { userId: true } } },
      });
    },
    async markProcessing(videoId) {
      const result = await prisma.video.updateMany({
        where: { id: videoId, status: 'UPLOADING' },
        data: { status: 'PROCESSING' },
      });
      return result.count === 1;
    },
    async listVideos(userId) {
      return prisma.video.findMany({
        where: { channel: { userId } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          channelId: true,
          title: true,
          status: true,
          visibility: true,
          thumbnailUrl: true,
          viewsCount: true,
          createdAt: true,
        },
      });
    },
  },
  storage: {
    createUploadUrl: generatePresignedUploadUrl,
    inspectObject: inspectRawObject,
  },
  queue: videoQueue,
});

app.use('/api/v1', videoUploadRouter);
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
app.use('/api/v1/monetization', monetizationRouter);
app.use('/api/v1/admin/monetization', monetizationRouter);

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
