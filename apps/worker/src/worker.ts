import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PrismaClient } from '@watchtube/database';
import { downloadRawVideo, uploadPublicFile } from './services/storage.service';
import { getVideoMetadata, extractPoster, extractThumbnails, createHLSRendition } from './services/transcode.service';

const prisma = new PrismaClient();

const redisConnection = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new IORedis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        maxRetriesPerRequest: null,
    });

// UUID validation regex (RFC 4122 standard)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    // In case multiple space-separated domains or URLs are passed, take the first one and strip protocol/trailing slashes
    const domain = raw.split(/\s+/)[0].replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!domain) {
        throw new Error(
            '[FATAL] Worker configuration error: Neither R2_PUBLIC_DOMAIN nor R2_BUCKET_PUBLIC_URL supplies a valid domain. Cannot generate public media URLs.'
        );
    }
    return domain;
}

const renditions = [
    { name: '360p', resolution: '640x360', videoBitrate: '600k', audioBitrate: '64k', bitrate: 600000 },
    { name: '720p', resolution: '1280x720', videoBitrate: '2000k', audioBitrate: '128k', bitrate: 2000000 },
    { name: '1080p', resolution: '1920x1080', videoBitrate: '4500k', audioBitrate: '192k', bitrate: 4500000 },
];

const worker = new Worker(
    'video-transcode',
    async (job: Job) => {
        const { videoId, rawStorageKey } = job.data;

        // 1. Validate videoId as a UUID before touching filesystem or database
        if (!videoId || typeof videoId !== 'string' || !UUID_REGEX.test(videoId)) {
            throw new Error(`Invalid videoId: "${videoId}" is not a valid UUID`);
        }

        console.log(`Starting job for video: ${videoId}`);

        const video = await prisma.video.findUnique({ where: { id: videoId } });
        if (!video || video.status !== 'PROCESSING') {
            throw new Error(`Video ${videoId} is not in PROCESSING state`);
        }

        // Validate public domain early to avoid starting work if URL generation cannot succeed
        const publicDomain = getPublicDomain();

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
            const posterS3Key = `media/${videoId}/poster.jpg`;
            await uploadPublicFile(path.join(workDir, 'poster.jpg'), posterS3Key, 'image/jpeg');
            const posterUrl = `https://${publicDomain}/${posterS3Key}`;

            console.log(`Uploading preview thumbnails...`);
            const allFiles = await fs.readdir(workDir);
            const thumbnailFiles = allFiles.filter(f => f.startsWith('thumbnail-') && f.endsWith('.jpg'));
            for (const thumb of thumbnailFiles) {
                const thumbS3Key = `media/${videoId}/${thumb}`;
                await uploadPublicFile(path.join(workDir, thumb), thumbS3Key, 'image/jpeg');
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
                    const tsS3Key = `media/${videoId}/${tsFile}`;
                    await uploadPublicFile(path.join(workDir, tsFile), tsS3Key, 'video/MP2T');
                }

                const m3u8S3Key = `media/${videoId}/${renditionFilename}`;
                await uploadPublicFile(renditionPath, m3u8S3Key, 'application/vnd.apple.mpegurl');

                const playlistUrl = `https://${publicDomain}/${m3u8S3Key}`;

                await prisma.videoVariant.create({
                    data: {
                        videoId,
                        resolution: rendition.name,
                        bitrate: rendition.bitrate,
                        playlistUrl
                    }
                });

                masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bitrate},RESOLUTION=${rendition.resolution}\n${renditionFilename}\n`;
            }

            const masterPath = path.join(workDir, 'master.m3u8');
            await fs.writeFile(masterPath, masterPlaylist);
            const masterS3Key = `media/${videoId}/master.m3u8`;
            await uploadPublicFile(masterPath, masterS3Key, 'application/vnd.apple.mpegurl');

            await prisma.video.update({
                where: { id: videoId },
                data: {
                    status: 'READY',
                    publishedAt: new Date(),
                    lowBandwidthReady: true,
                    thumbnailUrl: posterUrl,
                }
            });

            console.log(`Job for video ${videoId} completed successfully.`);

        } catch (error) {
            console.error(`Error processing video ${videoId}:`, error);
            await prisma.video.update({
                where: { id: videoId },
                data: { status: 'REJECTED' }
            });
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
    },
    { connection: redisConnection, concurrency: 2 }
);

// Graceful Shutdown
const shutdown = async () => {
    console.log('Shutting down worker gracefully...');
    await worker.close();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
