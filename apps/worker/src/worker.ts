import { Worker, Job, WorkerOptions, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { db as prisma } from '@watchtube/database';
import {
    getStorageConfigurationStatus,
    downloadRawVideo,
    uploadPrivateProcessingFile,
} from './services/storage.service';
import { getMediaToolStatus, getVideoMetadata, extractPoster, extractThumbnails, createHLSRendition } from './services/transcode.service';
import { assertSafeWorkerEndpoints } from './serviceEndpointSafety';
import {
    EmailOutboxProcessor,
    getEmailOutboxService,
    EmailOutboxService,
} from './services/email';

export {
    EmailOutboxProcessor,
    getEmailOutboxService,
    EmailOutboxService,
};

export function createRedisConnection(): IORedis {
    assertSafeWorkerEndpoints({
        databaseUrl: process.env.DATABASE_URL,
        redisUrl: process.env.REDIS_URL,
        redisHost: process.env.REDIS_HOST,
        nodeEnv: process.env.NODE_ENV,
        localOnly: process.env.WATCHTUBE_LOCAL_ONLY === '1',
        allowExternal: process.env.WATCHTUBE_ALLOW_EXTERNAL_SERVICES === '1',
    });
    return process.env.REDIS_URL
        ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
        : new IORedis({
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            maxRetriesPerRequest: null,
        });
}

export function isTerminalAttempt(job: Job, error?: unknown): boolean {
    if (error instanceof UnrecoverableError) return true;
    const attempts = Math.max(1, job.opts.attempts ?? 1);
    return job.attemptsMade >= attempts;
}

function getRawInputExtension(contentType: string | null | undefined): string {
    if (contentType === 'video/webm') return '.webm';
    if (contentType === 'video/quicktime') return '.mov';
    return '.mp4';
}

export function getWorkerOptions(connection: IORedis): WorkerOptions {
    return {
        connection,
        concurrency: 2,
        lockDuration: 30 * 60 * 1000,
        maxStalledCount: 1,
    };
}

// UUID validation regex (RFC 4122 standard)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_UPLOAD_KEY_REGEX = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Safely resolves the temporary base directory.
 * Prevents accidental or unsafe configuration pointing directly to filesystem root.
 */
function getSafeTempBaseDir(): string {
    const configured = process.env.WATCHTUBE_TEMP_DIR?.trim();
    const rawBase = configured || path.join(os.tmpdir(), 'watchtube');
    const resolvedBase = path.resolve(rawBase);
    const { root } = path.parse(resolvedBase);

    // Prevent configuring the base directory directly to the filesystem root (e.g., "/" or "C:\")
    if (resolvedBase === root) {
        throw new Error(`[FATAL] WATCHTUBE_TEMP_DIR cannot be configured to the filesystem root ("${resolvedBase}").`);
    }

    return resolvedBase;
}

const TEMP_BASE_DIR = getSafeTempBaseDir();

/**
 * Resolves and validates the public domain for serving transcoded assets.
 * Fails with a clear configuration error if neither R2_PUBLIC_DOMAIN nor
 * R2_BUCKET_PUBLIC_URL supplies a valid domain.
 */
export function getPublicDomain(): string {
    const raw = (process.env.R2_PUBLIC_DOMAIN || process.env.R2_BUCKET_PUBLIC_URL || '').trim();
    const candidate = raw.split(/\s+/)[0];
    if (
        !candidate
        || /(your[_-]|replace.?with|placeholder|x{4,})/i.test(candidate)
    ) {
        throw new Error('[Worker] Configure R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL to generate public media URLs.');
    }
    let url: URL;
    try {
        const httpsCandidate = candidate.replace(/^http:\/\//i, 'https://');
        url = new URL(httpsCandidate.includes('://') ? httpsCandidate : `https://${httpsCandidate}`);
    } catch {
        throw new Error('[Worker] R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL must be a valid HTTPS URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('[Worker] R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL must be a valid HTTPS URL.');
    }
    return `${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

const renditions = [
    { name: '360p', resolution: '640x360', videoBitrate: '600k', audioBitrate: '64k', bitrate: 600000 },
    { name: '720p', resolution: '1280x720', videoBitrate: '2000k', audioBitrate: '128k', bitrate: 2000000 },
    { name: '1080p', resolution: '1920x1080', videoBitrate: '4500k', audioBitrate: '192k', bitrate: 4500000 },
];
export const shortRenditions = [
    { name: '360p', resolution: '360x640', videoBitrate: '800k', audioBitrate: '96k', bitrate: 800000 },
    { name: '540p', resolution: '540x960', videoBitrate: '1800k', audioBitrate: '128k', bitrate: 1800000 },
    { name: '1080p', resolution: '1080x1920', videoBitrate: '3500k', audioBitrate: '128k', bitrate: 3500000 },
];
const MAX_SHORT_DURATION_SECONDS = 180;
export function validateShortMediaMetadata(duration: number, width: number, height: number): string | null {
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SHORT_DURATION_SECONDS) {
        return 'Short duration must be between 1 second and 3 minutes.';
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 'Short video dimensions could not be determined.';
    }
    const aspectRatio = width / height;
    if (aspectRatio < 0.50625 || aspectRatio > 0.61875) {
        return 'Short video must use a portrait aspect ratio close to 9:16.';
    }
    return null;
}

type VideoReadyTransitionRepository = {
    updateMany: (args: {
        where: { id: string; status: 'PROCESSING'; thumbnailStorageKey?: null };
        data: { status: 'READY_FOR_REVIEW'; thumbnailStorageKey?: string; lowBandwidthReady: true };
    }) => Promise<{ count: number }>;
};

export async function markVideoReadyForReview(
    repository: VideoReadyTransitionRepository,
    videoId: string,
    posterStorageKey: string,
): Promise<void> {
    const posterApplied = await repository.updateMany({
        where: { id: videoId, status: 'PROCESSING', thumbnailStorageKey: null },
        data: {
            status: 'READY_FOR_REVIEW',
            thumbnailStorageKey: posterStorageKey,
            lowBandwidthReady: true,
        },
    });
    if (posterApplied.count === 1) return;

    const retainedThumbnail = await repository.updateMany({
        where: { id: videoId, status: 'PROCESSING' },
        data: { status: 'READY_FOR_REVIEW', lowBandwidthReady: true },
    });
    if (retainedThumbnail.count !== 1) {
        throw new Error(`Video ${videoId} could not transition from PROCESSING to READY_FOR_REVIEW`);
    }
}

type VideoFailureTransitionRepository = {
    updateMany: (args: {
        where: { id: string; status: 'PROCESSING' };
        data: { status: 'FAILED' };
    }) => Promise<{ count: number }>;
};

export async function markVideoFailedIfProcessing(
    repository: VideoFailureTransitionRepository,
    videoId: string,
): Promise<boolean> {
    const result = await repository.updateMany({
        where: { id: videoId, status: 'PROCESSING' },
        data: { status: 'FAILED' },
    });
    return result.count === 1;
}

export function createVideoTranscodeProcessor() {
    return async (job: Job) => {
        const { videoId, rawStorageKey } = job.data;

        // 1. Validate videoId as a UUID before touching filesystem or database
        if (!videoId || typeof videoId !== 'string' || !UUID_REGEX.test(videoId)) {
            throw new UnrecoverableError(`Invalid videoId: "${videoId}" is not a valid UUID`);
        }

        console.log(`Starting job for video: ${videoId}`);

        const video = await prisma.video.findUnique({
            where: { id: videoId },
            include: { channel: { select: { userId: true } } },
        });
        if (!video || video.status !== 'PROCESSING') {
            throw new UnrecoverableError(`Video ${videoId} is not in PROCESSING state`);
        }
        if (
            typeof rawStorageKey !== 'string' ||
            !RAW_UPLOAD_KEY_REGEX.test(rawStorageKey) ||
            video.rawStorageKey !== rawStorageKey ||
            !rawStorageKey.startsWith(`uploads/${video.channel.userId}/`)
        ) {
            throw new UnrecoverableError(`Raw storage key does not match the video owner for ${videoId}`);
        }

        let workDir: string | null = null;

        try {
            // 2. Ensure base temporary scratch directory exists
            await fs.mkdir(TEMP_BASE_DIR, { recursive: true });

            // 3. Allocate a unique directory per attempt using fs.mkdtemp.
            // This guarantees fresh isolation even if BullMQ reuses the same job ID across retries.
            const attemptPrefix = path.join(TEMP_BASE_DIR, `${videoId}-attempt-`);
            workDir = await fs.mkdtemp(attemptPrefix);

            // 4. Verify path containment: workDir must reside strictly inside TEMP_BASE_DIR
            const normalizedBase = path.normalize(TEMP_BASE_DIR);
            const normalizedWorkDir = path.normalize(workDir);
            if (!normalizedWorkDir.startsWith(normalizedBase + path.sep)) {
                throw new Error(`Security violation: allocated workDir "${workDir}" is not contained within base "${TEMP_BASE_DIR}"`);
            }

            const rawVideoPath = path.join(workDir, `raw${getRawInputExtension(video.uploadContentType)}`);

            console.log(`Downloading raw video from ${rawStorageKey} to ${rawVideoPath}`);
            await downloadRawVideo(rawStorageKey, rawVideoPath);

            console.log(`Extracting metadata for ${videoId}`);
            let metadata;
            try {
                metadata = await getVideoMetadata(rawVideoPath);
            } catch {
                throw new UnrecoverableError(`Uploaded file for ${videoId} is not a readable video container.`);
            }
            const videoStream = metadata.streams?.find((item) => item.codec_type === 'video');
            const durationStr = metadata.format?.duration;
            const duration = durationStr ? parseFloat(durationStr as unknown as string) : 0;
            if (!videoStream || !Number.isFinite(duration) || duration <= 0) {
                throw new UnrecoverableError(`Uploaded file for ${videoId} does not contain a valid video stream.`);
            }
            const hasAudio = Boolean(metadata.streams?.some((item) => item.codec_type === 'audio'));
            if (video.isShort) {
                const width = videoStream.width;
                const height = videoStream.height;
                const validationError = validateShortMediaMetadata(duration, width ?? 0, height ?? 0);
                if (validationError) {
                    throw new UnrecoverableError(validationError);
                }
            }
            await prisma.video.update({
                where: { id: videoId },
                data: { duration },
                select: { id: true },
            });

            const posterTimestamp = duration >= 1.5 ? '00:00:01' : '0';
            console.log(`Extracting thumbnails for ${videoId}`);
            await extractPoster(rawVideoPath, workDir, video.isShort ? '360x640' : '1280x720', posterTimestamp);
            const timestamps = ['25%', '50%', '75%'];
            await extractThumbnails(rawVideoPath, workDir, timestamps, video.isShort ? '360x640' : '1280x720');

            console.log(`Uploading poster...`);
            const posterStorageKey = `processing/${videoId}/poster.jpg`;
            await uploadPrivateProcessingFile(path.join(workDir, 'poster.jpg'), posterStorageKey, 'image/jpeg');

            console.log(`Uploading preview thumbnails...`);
            const allFiles = await fs.readdir(workDir);
            const thumbnailFiles = allFiles.filter(f => f.startsWith('thumbnail-') && f.endsWith('.jpg'));
            for (const thumb of thumbnailFiles) {
                const thumbStorageKey = `processing/${videoId}/${thumb}`;
                await uploadPrivateProcessingFile(path.join(workDir, thumb), thumbStorageKey, 'image/jpeg');
            }

            let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n';

            for (const rendition of video.isShort ? shortRenditions : renditions) {
                console.log(`Processing rendition ${rendition.name} for ${videoId}`);
                const renditionFilename = `${rendition.name}.m3u8`;
                const renditionPath = path.join(workDir, renditionFilename);

                await createHLSRendition(rawVideoPath, renditionPath, rendition, { hasAudio });

                const files = await fs.readdir(workDir);
                const tsFiles = files.filter(f => f.startsWith(`${rendition.name}_`) && f.endsWith('.ts'));
                if (tsFiles.length === 0) {
                    throw new Error(`FFmpeg produced no HLS segments for rendition ${rendition.name}`);
                }

                for (const tsFile of tsFiles) {
                    const tsStorageKey = `processing/${videoId}/${tsFile}`;
                    await uploadPrivateProcessingFile(path.join(workDir, tsFile), tsStorageKey, 'video/MP2T');
                }

                const playlistStorageKey = `processing/${videoId}/${renditionFilename}`;
                await uploadPrivateProcessingFile(renditionPath, playlistStorageKey, 'application/vnd.apple.mpegurl');

                await prisma.$transaction(async (transaction) => {
                    await transaction.$executeRaw`
                        SELECT pg_advisory_xact_lock(hashtext(${videoId}), hashtext(${rendition.name}))
                    `;
                    const existingVariant = await transaction.videoVariant.findFirst({
                        where: { videoId, resolution: rendition.name },
                    });
                    if (existingVariant) {
                        await transaction.videoVariant.update({
                            where: { id: existingVariant.id },
                            data: { bitrate: rendition.bitrate, playlistUrl: playlistStorageKey },
                        });
                    } else {
                        await transaction.videoVariant.create({
                            data: {
                                videoId,
                                resolution: rendition.name,
                                bitrate: rendition.bitrate,
                                playlistUrl: playlistStorageKey,
                            },
                        });
                    }
                });

                masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate},RESOLUTION=${rendition.resolution}\n${renditionFilename}\n`;
            }

            const masterPath = path.join(workDir, 'master.m3u8');
            await fs.writeFile(masterPath, masterPlaylist);
            const masterStorageKey = `processing/${videoId}/master.m3u8`;
            await uploadPrivateProcessingFile(
                masterPath,
                masterStorageKey,
                'application/vnd.apple.mpegurl',
            );

            await markVideoReadyForReview(prisma.video, videoId, posterStorageKey);

            console.log(`Job for video ${videoId} completed successfully.`);

        } catch (error) {
            console.error(`Error processing video ${videoId}:`, error);
            if (isTerminalAttempt(job, error)) {
                try {
                    const markedFailed = await markVideoFailedIfProcessing(prisma.video, videoId);
                    if (!markedFailed) {
                        console.warn(`Video ${videoId} left PROCESSING before terminal failure; preserving its current status.`);
                    }
                } catch (statusError) {
                    console.error(`Failed to mark video ${videoId} as FAILED:`, statusError);
                }
            } else {
                console.warn(
                    `Job for video ${videoId} failed on attempt ${Math.max(1, job.attemptsMade)}; leaving status PROCESSING for retry`
                );
            }
            throw error;
        } finally {
            if (workDir) {
                console.log(`Cleaning up temporary files for video ${videoId} at ${workDir}`);
                try {
                    const normalizedBase = path.normalize(TEMP_BASE_DIR);
                    const normalizedWorkDir = path.normalize(workDir);
                    // Strictly verify containment before removal; never remove base or anything outside
                    if (normalizedWorkDir.startsWith(normalizedBase + path.sep) && normalizedWorkDir !== normalizedBase) {
                        await fs.rm(workDir, { recursive: true, force: true });
                    } else {
                        console.error(`Skipping unsafe temporary directory cleanup: "${workDir}" is outside base "${TEMP_BASE_DIR}"`);
                    }
                } catch (cleanupError) {
                    // Log cleanup error as a warning so it does not mask or overwrite any processing error from the try block
                    console.warn(`Failed to clean up temporary directory ${workDir}:`, cleanupError);
                }
            }
        }
    };
}

export function createWorker(connection: IORedis): Worker {
    return new Worker(
        'video-transcode',
        createVideoTranscodeProcessor(),
        getWorkerOptions(connection),
    );
}

let activeWorker: Worker | null = null;
let activeRedisConnection: IORedis | null = null;
let activeEmailProcessor: EmailOutboxProcessor | null = null;
let shuttingDown = false;

export function getActiveEmailProcessor(): EmailOutboxProcessor | null {
    return activeEmailProcessor;
}

export function setActiveEmailProcessor(processor: EmailOutboxProcessor | null): void {
    activeEmailProcessor = processor;
}

export function resetWorkerShutdownState(): void {
    shuttingDown = false;
}

export async function shutdownWorker(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down worker gracefully...');

    if (activeEmailProcessor) {
        try {
            await activeEmailProcessor.stop();
        } catch (error) {
            console.error('[Worker] Error stopping email outbox processor:', error instanceof Error ? error.message : error);
        }
        activeEmailProcessor = null;
    }

    if (activeWorker) {
        try {
            await activeWorker.close();
        } catch (error) {
            console.error('[Worker] Error closing video transcode worker:', error instanceof Error ? error.message : error);
        }
        activeWorker = null;
    }

    if (activeRedisConnection) {
        try {
            await activeRedisConnection.quit();
        } catch (error) {
            console.error('[Worker] Error closing Redis connection:', error instanceof Error ? error.message : error);
        }
        activeRedisConnection = null;
    }
}

export function startWorker(): void {
    if (!process.env.DATABASE_URL?.trim()) {
        console.error('[Worker] DATABASE_URL is required to process video jobs. Configure a local WatchTube database first.');
        process.exitCode = 1;
        return;
    }
    const storageConfiguration = getStorageConfigurationStatus(false);
    if (storageConfiguration.missing.length) {
        console.error(`[Worker] Cloud storage is not fully configured. Missing configuration: ${storageConfiguration.missing.join(', ')}.`);
        process.exitCode = 1;
        return;
    }
    const mediaTools = getMediaToolStatus();
    if (!mediaTools.ffmpeg || !mediaTools.ffprobe) {
        const missing = [
            ...(!mediaTools.ffmpeg ? ['ffmpeg'] : []),
            ...(!mediaTools.ffprobe ? ['ffprobe'] : []),
        ];
        console.error(`[Worker] Media processing tools are unavailable. Missing commands: ${missing.join(', ')}.`);
        process.exitCode = 1;
        return;
    }
    try {
        activeRedisConnection = createRedisConnection();
    } catch (error) {
        console.error(error instanceof Error ? error.message : '[Worker] Service configuration is invalid.');
        process.exitCode = 1;
        return;
    }
    let redisFailureLogged = false;
    activeRedisConnection.on('ready', () => {
        redisFailureLogged = false;
        console.log('[Worker] Redis connection established; video processing is available.');
    });
    activeRedisConnection.on('error', (error: NodeJS.ErrnoException) => {
        if (redisFailureLogged) return;
        redisFailureLogged = true;
        const code = error.code ? ` (${error.code})` : '';
        console.error(`[Worker] Redis is unavailable${code}; video processing will resume after reconnection.`);
    });
    activeWorker = createWorker(activeRedisConnection);
    activeWorker.on('error', (error: NodeJS.ErrnoException) => {
        if (redisFailureLogged) return;
        redisFailureLogged = true;
        const code = error.code ? ` (${error.code})` : '';
        console.error(`[Worker] Queue processing is temporarily unavailable${code}.`);
    });

    try {
        const emailIntervalMs = parseInt(process.env.EMAIL_OUTBOX_INTERVAL_MS || '5000', 10) || 5000;
        const emailBatchSize = parseInt(process.env.EMAIL_OUTBOX_BATCH_SIZE || '20', 10) || 20;
        const emailService = getEmailOutboxService();
        activeEmailProcessor = new EmailOutboxProcessor(emailService, emailIntervalMs, emailBatchSize);
        activeEmailProcessor.start();
        console.log(`[Worker] Email outbox processor started (interval: ${emailIntervalMs}ms, batchSize: ${emailBatchSize}).`);
    } catch (error: unknown) {
        console.error('[Worker] Failed to start email outbox processor:', error instanceof Error ? error.message : error);
    }

    const shutdown = () => {
        void shutdownWorker().finally(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

if (require.main === module) {
    startWorker();
}
