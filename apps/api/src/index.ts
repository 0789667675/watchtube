import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { db as prisma } from '@watchtube/database';
import {
  createChannelImageUploadTarget,
  generatePresignedUploadUrl,
  inspectRawObject,
  publishVerifiedChannelImage,
} from './services/storage.service';
import { authRouter } from './routes/auth.route';
import { interactionRouter } from './routes/interaction.route';
import { analyticsRouter } from './routes/analytics.route';
import { feedRouter } from './routes/feed.route';
import { studioRouter } from './routes/studio.route';
import { createCreatorCommentsRouter } from './routes/creator-comments.route';
import { walletRouter } from './routes/wallet.route';
import { trustRouter } from './routes/trust.route';
import { adminRouter } from './routes/admin.route';
import { monetizationRouter } from './routes/monetization.route';
import { createChannelRouter } from './routes/channel.route';
import { createChannelImageUploadRouter } from './routes/channel-image-upload.route';
import { authenticate } from './middleware/auth';
import { createVideoUploadRouter } from './routes/video-upload.route';
import { createCorsMiddleware, parseAllowedOrigins } from './middleware/cors';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { JWT_SECRET } from './config/jwt';
import { assertSafeServiceEndpoints } from './config/serviceEndpointSafety';

const app = express();
if (!process.env.DATABASE_URL?.trim()) {
  console.error('[API] DATABASE_URL is required. Set it in the environment or apps/api/.env.');
  process.exit(1);
}

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('[API] PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

assertSafeServiceEndpoints({
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  redisHost: process.env.REDIS_HOST,
  nodeEnv: process.env.NODE_ENV,
  localOnly: process.env.WATCHTUBE_LOCAL_ONLY === '1',
  allowExternal: process.env.WATCHTUBE_ALLOW_EXTERNAL_SERVICES === '1',
});

// Setup Redis & BullMQ
const connection = process.env.REDIS_URL
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
    });
const videoQueue = new Queue('video-transcode', { connection });
const getDatabaseErrorCode = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return '';
  if ('errorCode' in error && typeof error.errorCode === 'string') return ` (${error.errorCode})`;
  if ('code' in error && typeof error.code === 'string') return ` (${error.code})`;
  return '';
};
let redisFailureLogged = false;
connection.on('ready', () => {
  redisFailureLogged = false;
  console.log('[API] Redis connection established.');
});
connection.on('error', (error: NodeJS.ErrnoException) => {
  if (redisFailureLogged) return;
  redisFailureLogged = true;
  const code = error.code ? ` (${error.code})` : '';
  console.error(`[API] Redis is unavailable${code}; queue-dependent operations may fail. Check REDIS_URL or REDIS_HOST/REDIS_PORT.`);
});

void prisma.$connect()
  .then(async () => {
    console.log('[API] PostgreSQL connection established.');
    try {
      await prisma.video.findFirst({ select: { id: true } });
    } catch (error) {
      console.error(`[API] PostgreSQL is reachable, but the WatchTube schema check failed${getDatabaseErrorCode(error)}. Database-backed routes may fail; verify the configured database schema.`);
    }
  })
  .catch((error: unknown) => {
    console.error(`[API] PostgreSQL connection failed${getDatabaseErrorCode(error)}. The server will listen, but database-backed routes may fail. Check DATABASE_URL and database availability.`);
  });

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

const channelRouter = createChannelRouter({
  authenticate,
  repository: {
    async createChannel(input) {
      return prisma.channel.create({
        data: input,
        select: {
          id: true,
          name: true,
          handle: true,
          description: true,
          avatarUrl: true,
          bannerUrl: true,
        },
      });
    },
    async findPublicChannel(handle) {
      return prisma.channel.findUnique({
        where: { handle },
        select: {
          id: true,
          name: true,
          handle: true,
          description: true,
          avatarUrl: true,
          bannerUrl: true,
          subscriberCount: true,
          isVerified: true,
          videos: {
            where: { status: 'READY', visibility: 'PUBLIC' },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              title: true,
              description: true,
              thumbnailUrl: true,
              duration: true,
              viewsCount: true,
              createdAt: true,
              publishedAt: true,
            },
          },
        },
      });
    },
    async findOwnedChannel(channelId, userId) {
      return prisma.channel.findFirst({
        where: { id: channelId, userId },
        select: {
          id: true,
          name: true,
          handle: true,
          description: true,
          avatarUrl: true,
          bannerUrl: true,
        },
      });
    },
    async handleExists(handle, exceptChannelId) {
      return Boolean(await prisma.channel.findFirst({
        where: {
          handle,
          ...(exceptChannelId ? { id: { not: exceptChannelId } } : {}),
        },
        select: { id: true },
      }));
    },
    async updateOwnedChannel(channelId, userId, data) {
      const result = await prisma.channel.updateMany({
        where: { id: channelId, userId },
        data,
      });
      if (result.count !== 1) return null;
      return prisma.channel.findFirst({
        where: { id: channelId, userId },
        select: {
          id: true,
          name: true,
          handle: true,
          description: true,
          avatarUrl: true,
          bannerUrl: true,
        },
      });
    },
  },
});

const channelImageUploadRouter = createChannelImageUploadRouter({
  authenticate,
  ticketSecret: JWT_SECRET,
  repository: {
    async ownsChannel(channelId, userId) {
      return Boolean(await prisma.channel.findFirst({
        where: { id: channelId, userId },
        select: { id: true },
      }));
    },
    async updateOwnedImage(channelId, userId, purpose, imageUrl) {
      const result = await prisma.channel.updateMany({
        where: { id: channelId, userId },
        data: purpose === 'avatar' ? { avatarUrl: imageUrl } : { bannerUrl: imageUrl },
      });
      if (result.count !== 1) return null;
      return prisma.channel.findFirst({
        where: { id: channelId, userId },
        select: {
          id: true,
          name: true,
          handle: true,
          description: true,
          avatarUrl: true,
          bannerUrl: true,
        },
      });
    },
  },
  storage: {
    createUploadTarget: createChannelImageUploadTarget,
    publishUploadedImage: publishVerifiedChannelImage,
  },
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

const creatorCommentsRouter = createCreatorCommentsRouter({
  authenticate,
  repository: {
    async ownsChannel(channelId, userId) {
      return Boolean(await prisma.channel.findFirst({
        where: { id: channelId, userId },
        select: { id: true },
      }));
    },
    async listComments({ channelId, userId, page, limit, search }) {
      const where = {
        AND: [
          { video: { channelId, channel: { userId } } },
          ...(search ? [{
            OR: [
              { content: { contains: search, mode: 'insensitive' as const } },
              { video: { title: { contains: search, mode: 'insensitive' as const } } },
            ],
          }] : []),
        ],
      };
      const [comments, total] = await prisma.$transaction([
        prisma.comment.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            content: true,
            parentId: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                channels: {
                  take: 1,
                  orderBy: { createdAt: 'asc' },
                  select: { name: true, handle: true, avatarUrl: true },
                },
              },
            },
            video: { select: { id: true, title: true } },
          },
        }),
        prisma.comment.count({ where }),
      ]);
      return { comments, total };
    },
    async deleteComment({ channelId, commentId, userId }) {
      const result = await prisma.comment.deleteMany({
        where: {
          id: commentId,
          video: { channelId, channel: { userId } },
        },
      });
      return result.count === 1;
    },
  },
});

app.use('/api/v1', videoUploadRouter);
app.use('/api/v1', apiRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/channels', channelImageUploadRouter);
app.use('/api/v1/channels', channelRouter);
app.use('/api/v1', interactionRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/feed', feedRouter);
app.use('/api/v1/studio', studioRouter);
app.use('/api/v1/studio', creatorCommentsRouter);
app.use('/api/v1/wallet', walletRouter);
app.use('/api/v1', trustRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/monetization', monetizationRouter);
app.use('/api/v1/admin/monetization', monetizationRouter);

const server = app.listen({
  port,
  ...(process.env.WATCHTUBE_LOCAL_ONLY === '1' ? { host: '127.0.0.1' } : {}),
}, () => {
  console.log(`API server listening on port ${port}`);
});
let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[API] Shutting down gracefully...');

  await new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        console.error('[API] Failed to close the HTTP server cleanly.');
        process.exitCode = 1;
      }
      resolve();
    });
  });

  try {
    await videoQueue.close();
  } catch {
    console.error('[API] Failed to close the video queue cleanly.');
    process.exitCode = 1;
  }
  connection.disconnect();

  try {
    await prisma.$disconnect();
  } catch {
    console.error('[API] Failed to disconnect from PostgreSQL cleanly.');
    process.exitCode = 1;
  }
  console.log('[API] Shutdown complete.');
};

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[API] Port ${port} is already in use. Stop the conflicting process or choose another PORT.`);
  } else {
    console.error(`[API] Failed to listen on port ${port} (${error.code || 'unknown error'}).`);
  }
  process.exitCode = 1;
  void shutdown();
});

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

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
