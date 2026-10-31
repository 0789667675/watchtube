import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaClient } from '@watchtube/database';
import { downloadRawVideo, uploadPublicFile } from './services/storage.service';
import { getVideoMetadata, extractPoster, extractThumbnails, createHLSRendition } from './services/transcode.service';

const prisma = new PrismaClient();

const redisConnection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
});

const TEMP_DIR = '/tmp/watchtube';

const renditions = [
    { name: '360p', resolution: '640x360', videoBitrate: '600k', audioBitrate: '64k', bitrate: 600000 },
    { name: '720p', resolution: '1280x720', videoBitrate: '2000k', audioBitrate: '128k', bitrate: 2000000 },
    { name: '1080p', resolution: '1920x1080', videoBitrate: '4500k', audioBitrate: '192k', bitrate: 4500000 },
];

const worker = new Worker(
    'video-transcode',
    async (job: Job) => {
        const { videoId, rawStorageKey } = job.data;
        console.log(`Starting job for video: ${videoId}`);

        const video = await prisma.video.findUnique({ where: { id: videoId } });
        if (!video || video.status !== 'PROCESSING') {
            throw new Error(`Video ${videoId} is not in PROCESSING state`);
        }

        const workDir = path.join(TEMP_DIR, videoId);
        await fs.mkdir(workDir, { recursive: true });

        const rawVideoPath = path.join(workDir, 'raw.mp4');

        try {
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
            const posterUrl = `https://${process.env.R2_BUCKET_PUBLIC_URL}/${posterS3Key}`;

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

                const playlistUrl = `https://${process.env.R2_BUCKET_PUBLIC_URL}/${m3u8S3Key}`;

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
            console.log(`Cleaning up temporary files for ${videoId}`);
            await fs.rm(workDir, { recursive: true, force: true });
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
