import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { PrismaClient } from '@watchtube/database';
import { generatePresignedUploadUrl, verifyObjectExists } from './services/storage.service';
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

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
