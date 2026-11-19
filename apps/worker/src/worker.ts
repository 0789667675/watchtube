import { Worker, Job, WorkerOptions } from 'bullmq';
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
import { getVideoMetadata, extractPoster, extractThumbnails, createHLSRendition } from './services/transcode.service';
import { assertSafeWorkerEndpoints } from './serviceEndpointSafety';

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

export function isTerminalAttempt(job: Job): boolean {
    const attempts = job.opts.attempts ?? 1;
    return job.attemptsMade + 1 >= attempts;
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
            throw new Error(`Invalid videoId: "${videoId}" is not a valid UUID`);
        }

        console.log(`Starting job for video: ${videoId}`);

        const video = await prisma.video.findUnique({
            where: { id: videoId },
            include: { channel: { select: { userId: true } } },
        });
        if (!video || video.status !== 'PROCESSING') {
            throw new Error(`Video ${videoId} is not in PROCESSING state`);
        }
        if (
            typeof rawStorageKey !== 'string' ||
            !RAW_UPLOAD_KEY_REGEX.test(rawStorageKey) ||
            video.rawStorageKey !== rawStorageKey ||
            !rawStorageKey.startsWith(`uploads/${video.channel.userId}/`)
        ) {
            throw new Error(`Raw storage key does not match the video owner for ${videoId}`);
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

            const rawVideoPath = path.join(workDir, 'raw.mp4');

            console.log(`Downloading raw video from ${rawStorageKey} to ${rawVideoPath}`);
            await downloadRawVideo(rawStorageKey, rawVideoPath);

            console.log(`Extracting metadata for ${videoId}`);
            const metadata = await getVideoMetadata(rawVideoPath);
            const durationStr = metadata.format.duration;
            const duration = durationStr ? parseFloat(durationStr as unknown as string) : 0;
            await prisma.video.update({ where: { id: videoId }, data: { duration } });

            console.log(`Extracting thumbnails for ${videoId}`);
            await extractPoster(rawVideoPath, workDir);
            const timestamps = ['25%', '50%', '75%'];
            await extractThumbnails(rawVideoPath, workDir, timestamps);

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

            for (const rendition of renditions) {
                console.log(`Processing rendition ${rendition.name} for ${videoId}`);
                const renditionFilename = `${rendition.name}.m3u8`;
                const renditionPath = path.join(workDir, renditionFilename);

                await createHLSRendition(rawVideoPath, renditionPath, rendition);

                const files = await fs.readdir(workDir);
                const tsFiles = files.filter(f => f.startsWith(rendition.name) && f.endsWith('.ts'));

                for (const tsFile of tsFiles) {
                    const tsStorageKey = `processing/${videoId}/${tsFile}`;
                    await uploadPrivateProcessingFile(path.join(workDir, tsFile), tsStorageKey, 'video/MP2T');
                }

                const playlistStorageKey = `processing/${videoId}/${renditionFilename}`;

                await prisma.$transaction(async (transaction) => {
                    await transaction.$queryRaw`
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
            if (isTerminalAttempt(job)) {
                try {
                    const markedFailed = await markVideoFailedIfProcessing(prisma.video, videoId);
                    if (!markedFailed) {
                        console.warn(`Video ${videoId} left PROCESSING before terminal failure; preserving its current status.`);
                    }
                } catch (statusError) {
                    console.error(`Failed to mark video ${videoId} as REJECTED:`, statusError);
                }
            } else {
                console.warn(
                    `Job for video ${videoId} failed on attempt ${job.attemptsMade + 1}; leaving status PROCESSING for retry`
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
let shuttingDown = false;

export async function shutdownWorker(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down worker gracefully...');
    if (activeWorker) await activeWorker.close();
    if (activeRedisConnection) await activeRedisConnection.quit();
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

    const shutdown = () => {
        void shutdownWorker().finally(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
}

if (require.main === module) {
    startWorker();
}
