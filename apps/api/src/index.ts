import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { db as prisma } from '@watchtube/database';
import {
  createChannelImageUploadTarget,
  generatePresignedUploadUrl,
  inspectRawObject,
  createVideoThumbnailUploadTarget,
  normalizeUploadedVideoThumbnail,
  publishProcessedVideoAssets,
  deletePublishedVideoAssets,
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
import { publicVideoWhere } from './security/publicContent';
import { createPublicVideosHandler } from './routes/feed.route';
import { createHealthRouter } from './routes/health.route';
import { getStorageConfigurationStatus } from './services/storage.service';
import { sendDatabaseErrorResponse } from './config/databaseErrors';

const app = express();
const localOnly = process.env.WATCHTUBE_LOCAL_ONLY === '1';
const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
if (!databaseConfigured && !localOnly) {
  console.error('[API] DATABASE_URL is required outside local-only development.');
  process.exit(1);
}

if (!databaseConfigured) {
  console.warn('[API] DATABASE_URL is not configured; database-backed requests will return HTTP 503.');
}

const portSetting = localOnly
  ? process.env.API_PORT || '3001'
  : process.env.PORT || process.env.API_PORT || '3001';
if (localOnly && process.env.PORT && !process.env.API_PORT) {
  console.warn('[API] PORT is ignored in local-only mode; use API_PORT to configure the API listener.');
}
const port = Number(portSetting);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('[API] API_PORT (or PORT outside local-only mode) must be an integer between 1 and 65535.');
  process.exit(1);
}

assertSafeServiceEndpoints({
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  redisHost: process.env.REDIS_HOST,
  nodeEnv: process.env.NODE_ENV,
  localOnly,
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
const logRedisUnavailable = (error: NodeJS.ErrnoException) => {
  if (redisFailureLogged) return;
  redisFailureLogged = true;
  const code = error.code ? ` (${error.code})` : '';
  console.error(`[API] Redis is unavailable${code}; queue-dependent operations may fail. Check REDIS_URL or REDIS_HOST/REDIS_PORT.`);
};
connection.on('ready', () => {
  redisFailureLogged = false;
  console.log('[API] Redis connection established.');
});
connection.on('error', logRedisUnavailable);
videoQueue.on('error', logRedisUnavailable);

if (databaseConfigured) {
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
}

const storageConfiguration = getStorageConfigurationStatus();
if (storageConfiguration.status !== 'configured') {
  console.warn(`[API] Cloud storage is not fully configured. Missing configuration: ${storageConfiguration.missing.join(', ') || 'public media URL'}.`);
}

const allowedOrigins = parseAllowedOrigins(process.env.API_ALLOWED_ORIGINS, process.env.NODE_ENV === 'production');
app.use(createCorsMiddleware(allowedOrigins));

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

const healthRouter = createHealthRouter({
  databaseConfigured,
  async checkDatabase() {
    await prisma.video.findFirst({ select: { id: true } });
  },
  getRedisStatus: () => connection.status === 'ready' ? 'connected' : 'unavailable',
  getStorageStatus: getStorageConfigurationStatus,
});
app.use(healthRouter);
app.use('/api/v1', healthRouter);

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
            where: {
              status: { in: ['READY', 'PUBLISHED'] },
              visibility: 'PUBLIC',
            },
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
    async createDraft(data) {
      return prisma.video.create({ data, select: { id: true } });
    },
    async updateMetadata({ videoId, userId, metadata }) {
      const currentVideo = await prisma.video.findFirst({
        where: { id: videoId, channel: { userId } },
        select: { copyrightDeclared: true },
      });
      if (!currentVideo) return false;
      const result = await prisma.video.updateMany({
        where: { id: videoId, channel: { userId } },
        data: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          category: metadata.category,
          language: metadata.language,
          madeForKids: metadata.madeForKids,
          visibility: metadata.visibility,
          ...(metadata.copyrightDeclared && !currentVideo.copyrightDeclared ? {
            copyrightDeclared: true,
            copyrightDeclaredAt: new Date(),
            copyrightDeclaredById: userId,
          } : {}),
          ...(metadata.visibility === 'PRIVATE' ? { thumbnailUrl: null } : {}),
        },
      });
      return result.count === 1;
    },
    async setUploadTarget({ videoId, userId, rawStorageKey, contentType, fileSize }) {
      const result = await prisma.video.updateMany({
        where: {
          id: videoId,
          status: 'DRAFT',
          rawStorageKey: null,
          channel: { userId },
        },
        data: {
          rawStorageKey,
          uploadContentType: contentType,
          uploadFileSize: BigInt(fileSize),
          status: 'UPLOADING',
        },
      });
      return result.count === 1;
    },
    async setPendingThumbnailUpload({ videoId, userId, key, contentType, fileSize }) {
      const result = await prisma.video.updateMany({
        where: {
          id: videoId,
          channel: { userId },
          status: { notIn: ['REJECTED', 'BLOCKED'] },
        },
        data: {
          pendingThumbnailStorageKey: key,
          pendingThumbnailContentType: contentType,
          pendingThumbnailFileSize: BigInt(fileSize),
        },
      });
      return result.count === 1;
    },
    async confirmThumbnailUpload(videoId, userId, storageKey) {
      const result = await prisma.video.updateMany({
        where: {
          id: videoId,
          channel: { userId },
          pendingThumbnailStorageKey: storageKey,
        },
        data: {
          thumbnailStorageKey: storageKey,
          pendingThumbnailStorageKey: null,
          pendingThumbnailContentType: null,
          pendingThumbnailFileSize: null,
        },
      });
      return result.count === 1;
    },
    async findVideo(videoId) {
      return prisma.video.findUnique({
        where: { id: videoId },
        include: { channel: { select: { userId: true } } },
      });
    },
    async markProcessing(videoId) {
      const result = await prisma.video.updateMany({
        where: { id: videoId, status: 'UPLOADED' },
        data: { status: 'PROCESSING', processingAttempts: { increment: 1 } },
      });
      if (result.count !== 1) return null;
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { processingAttempts: true },
      });
      return video?.processingAttempts ?? null;
    },
    async markUploaded(videoId) {
      const result = await prisma.video.updateMany({
        where: { id: videoId, status: { in: ['UPLOADING', 'FAILED'] } },
        data: { status: 'UPLOADED' },
      });
      return result.count === 1;
    },
    async hasBlockingCopyrightClaim(videoId) {
      return Boolean(await prisma.copyrightClaim.findFirst({
        where: { videoId, status: 'APPROVED_TAKEDOWN' },
        select: { id: true },
      }));
    },
    async publishVideo({ videoId, thumbnailUrl, playlistUrls }) {
      return prisma.$transaction(async (transaction) => {
        const blockingClaim = await transaction.copyrightClaim.findFirst({
          where: { videoId, status: 'APPROVED_TAKEDOWN' },
          select: { id: true },
        });
        if (blockingClaim) {
          await transaction.video.updateMany({
            where: { id: videoId },
            data: { status: 'BLOCKED', visibility: 'PRIVATE', copyrightReviewStatus: 'BLOCKED' },
          });
          return false;
        }
        const updated = await transaction.video.updateMany({
          where: { id: videoId, status: { in: ['READY_FOR_REVIEW', 'PUBLISHED'] } },
          data: { status: 'PUBLISHED', publishedAt: new Date(), ...(thumbnailUrl ? { thumbnailUrl } : {}) },
        });
        if (updated.count !== 1) return false;
        if (playlistUrls) {
          for (const [resolution, playlistUrl] of Object.entries(playlistUrls)) {
            await transaction.videoVariant.updateMany({
              where: { videoId, resolution },
              data: { playlistUrl },
            });
          }
        }
        return true;
      });
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
          description: true,
          tags: true,
          category: true,
          language: true,
          madeForKids: true,
          copyrightDeclared: true,
          copyrightReviewStatus: true,
          viewsCount: true,
          createdAt: true,
        },
      });
    },
  },
  storage: {
    createUploadUrl: generatePresignedUploadUrl,
    inspectObject: inspectRawObject,
    createThumbnailUploadTarget: createVideoThumbnailUploadTarget,
    normalizeThumbnail: normalizeUploadedVideoThumbnail,
    publishAssets: publishProcessedVideoAssets,
    deletePublishedAssets: deletePublishedVideoAssets,
  },
  queue: videoQueue,
  isQueueReady: () => connection.status === 'ready',
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
  ...(localOnly ? { host: '127.0.0.1' } : {}),
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
    console.error(`[API] Port ${port} is already in use. Stop the conflicting process or choose another ${localOnly ? 'API_PORT' : 'PORT'}.`);
  } else {
    console.error(`[API] Failed to listen on port ${port} (${error.code || 'unknown error'}).`);
  }
  process.exitCode = 1;
  void shutdown();
});

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

// Public Video APIs
apiRouter.get('/videos', createPublicVideosHandler((query) => prisma.video.findMany(query)));

apiRouter.get('/videos/:id', async (req: Request, res: Response) => {
  try {
    const videoId = req.params.id;

    const video = await prisma.video.findFirst({
      where: publicVideoWhere(videoId),
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
    console.error('[API] Public video lookup failed.');
    sendDatabaseErrorResponse(
      res,
      error,
      'Video data is temporarily unavailable because the database is unavailable.',
    );
  }
});
