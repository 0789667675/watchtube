import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { UnrecoverableError, type Job } from 'bullmq';
import {
    getPublicDomain,
    getWorkerOptions,
    isTerminalAttempt,
    markVideoFailedIfProcessing,
    markVideoReadyForReview,
    shortRenditions,
    shutdownWorker,
    validateShortMediaMetadata,
} from '../src/worker';
import {
    downloadRawVideo,
    getStorageConfigurationStatus,
} from '../src/services/storage.service';
import { createHLSRendition, extractPoster, extractThumbnails, getMediaToolStatus, getVideoMetadata } from '../src/services/transcode.service';
import { assertSafeWorkerEndpoints } from '../src/serviceEndpointSafety';

test('Short media metadata enforces duration and portrait aspect ratio', () => {
    assert.equal(validateShortMediaMetadata(60, 1080, 1920), null);
    assert.match(validateShortMediaMetadata(181, 1080, 1920) ?? '', /3 minutes/);
    assert.match(validateShortMediaMetadata(60, 1920, 1080) ?? '', /portrait|9:16/);
    assert.match(validateShortMediaMetadata(60, 0, 1920) ?? '', /dimensions/);
});

test('media tool status reports command availability without exposing paths', () => {
    const status = getMediaToolStatus();
    assert.equal(typeof status.ffmpeg, 'boolean');
    assert.equal(typeof status.ffprobe, 'boolean');
});

test('Shorts use a portrait-only resolution ladder with matching quality labels', () => {
    assert.deepEqual(shortRenditions.map(({ name, resolution }) => [name, resolution]), [
        ['360p', '360x640'],
        ['540p', '540x960'],
        ['1080p', '1080x1920'],
    ]);
});

test('public domain validation rejects missing configuration', () => {
    const previous = process.env.R2_PUBLIC_DOMAIN;
    const previousUrl = process.env.R2_BUCKET_PUBLIC_URL;
    delete process.env.R2_PUBLIC_DOMAIN;
    delete process.env.R2_BUCKET_PUBLIC_URL;
    try {
        assert.throws(() => getPublicDomain(), /public media URLs/);
    } finally {
        if (previous === undefined) delete process.env.R2_PUBLIC_DOMAIN;
        else process.env.R2_PUBLIC_DOMAIN = previous;
        if (previousUrl === undefined) delete process.env.R2_BUCKET_PUBLIC_URL;
        else process.env.R2_BUCKET_PUBLIC_URL = previousUrl;
    }
});

test('public domain validation rejects template placeholders', () => {
    const previous = process.env.R2_PUBLIC_DOMAIN;
    process.env.R2_PUBLIC_DOMAIN = 'https://your-public-domain.example';
    try {
        assert.throws(() => getPublicDomain(), /Configure R2_PUBLIC_DOMAIN/);
    } finally {
        if (previous === undefined) delete process.env.R2_PUBLIC_DOMAIN;
        else process.env.R2_PUBLIC_DOMAIN = previous;
    }
});

test('public media URLs keep HTTPS when configured with an HTTP origin', () => {
    const previous = process.env.R2_PUBLIC_DOMAIN;
    process.env.R2_PUBLIC_DOMAIN = 'http://media.example.invalid/base';
    try {
        assert.equal(getPublicDomain(), 'media.example.invalid/base');
    } finally {
        if (previous === undefined) delete process.env.R2_PUBLIC_DOMAIN;
        else process.env.R2_PUBLIC_DOMAIN = previous;
    }
});

test('local-only worker startup rejects external database and Redis endpoints', () => {
    assert.throws(
        () => assertSafeWorkerEndpoints({
            databaseUrl: 'postgresql://user:password@db.example.invalid:5432/watchtube',
            redisUrl: 'redis://127.0.0.1:6379',
            localOnly: true,
        }),
        /DATABASE_URL.*loopback/,
    );
    assert.throws(
        () => assertSafeWorkerEndpoints({
            databaseUrl: 'postgresql://user:password@127.0.0.1:5432/watchtube',
            redisUrl: 'redis://cache.example.invalid:6379',
            localOnly: true,
        }),
        /Redis.*loopback/,
    );
});

test('storage readiness reports missing variable names without values', () => {
    const names = [
        'CLOUDFLARE_ACCOUNT_ID',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_PUBLIC_DOMAIN',
        'R2_BUCKET_PUBLIC_URL',
    ] as const;
    const previous = names.map((name) => process.env[name]);
    names.forEach((name) => delete process.env[name]);
    try {
        const status = getStorageConfigurationStatus();
        assert.deepEqual(status.missing, [
            'CLOUDFLARE_ACCOUNT_ID',
            'R2_ACCESS_KEY_ID',
            'R2_SECRET_ACCESS_KEY',
            'R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL',
        ]);
    } finally {
        names.forEach((name, index) => {
            if (previous[index] === undefined) delete process.env[name];
            else process.env[name] = previous[index];
        });
    }
});

test('terminal attempt detection follows BullMQ job attempt counts', () => {
    const job = {
        attemptsMade: 3,
        opts: { attempts: 3 },
    } as unknown as Job;
    assert.equal(isTerminalAttempt(job), true);

    job.attemptsMade = 2;
    assert.equal(isTerminalAttempt(job), false);

    job.attemptsMade = 0;
    assert.equal(isTerminalAttempt(job), false);
});

test('worker reliability options enable locking, stall protection, and bounded concurrency', () => {
    const connection = {} as any;
    const options = getWorkerOptions(connection);
    assert.equal(options.concurrency, 2);
    assert.equal(options.maxStalledCount, 1);
    assert.equal(options.lockDuration, 30 * 60 * 1000);
});

test('processing completion preserves a creator-selected thumbnail and generates a fallback when absent', async () => {
    const createRepository = (thumbnailStorageKey: string | null) => {
        let currentThumbnail = thumbnailStorageKey;
        let status = 'PROCESSING';
        const repository = {
            async updateMany(args: {
                where: { id: string; status: 'PROCESSING'; thumbnailStorageKey?: null };
                data: { status: 'READY_FOR_REVIEW'; thumbnailStorageKey?: string; lowBandwidthReady: true };
            }) {
                if (status !== args.where.status) return { count: 0 };
                if ('thumbnailStorageKey' in args.where && currentThumbnail !== null) return { count: 0 };
                status = args.data.status;
                if (args.data.thumbnailStorageKey) currentThumbnail = args.data.thumbnailStorageKey;
                return { count: 1 };
            },
        };
        return { repository, get state() { return { status, thumbnailStorageKey: currentThumbnail }; } };
    };

    const custom = createRepository('processing/video/custom-thumbnail.webp');
    await markVideoReadyForReview(custom.repository, 'video-id', 'processing/video/poster.jpg');
    assert.deepEqual(custom.state, {
        status: 'READY_FOR_REVIEW',
        thumbnailStorageKey: 'processing/video/custom-thumbnail.webp',
    });

    const generated = createRepository(null);
    await markVideoReadyForReview(generated.repository, 'video-id', 'processing/video/poster.jpg');
    assert.deepEqual(generated.state, {
        status: 'READY_FOR_REVIEW',
        thumbnailStorageKey: 'processing/video/poster.jpg',
    });
});

test('processing completion does not advance a video that left PROCESSING', async () => {
    await assert.rejects(
        markVideoReadyForReview({
            updateMany: async () => ({ count: 0 }),
        }, 'video-id', 'processing/video/poster.jpg'),
        /could not transition from PROCESSING/,
    );
});

test('terminal processing failure does not overwrite a video that left PROCESSING', async () => {
    let status = 'BLOCKED';
    const repository = {
        updateMany: async (args: {
            where: { id: string; status: 'PROCESSING' };
            data: { status: 'FAILED' };
        }) => {
            if (status !== args.where.status) return { count: 0 };
            status = args.data.status;
            return { count: 1 };
        },
    };

    assert.equal(await markVideoFailedIfProcessing(repository, 'video-id'), false);
    assert.equal(status, 'BLOCKED');
});

test('shutdown is safe before the worker is started', async () => {
    await shutdownWorker();
});

test('storage functions reject unsafe keys before creating a request', async () => {
    await assert.rejects(() => downloadRawVideo('../secret', 'ignored'), /Unsafe raw storage key/);
    await assert.rejects(() => downloadRawVideo('', 'ignored'), /Unsafe raw storage key/);
});

test('transcode functions validate paths and rendition values locally', async () => {
    await assert.rejects(() => getVideoMetadata(''), /input path is required/i);
    await assert.rejects(() => extractPoster('', 'ignored'), /input path is required/i);
    await assert.rejects(() => extractThumbnails('', 'ignored', []), /input path is required/i);
    await assert.rejects(() => extractThumbnails('input.mp4', 'ignored', []), /At least one thumbnail timestamp is required/i);
    await assert.rejects(() => createHLSRendition('input.mp4', 'output.m3u8', {
        name: '360p',
        resolution: '',
        videoBitrate: '600k',
        audioBitrate: '64k',
    }), /Invalid HLS rendition configuration/);
    await assert.rejects(() => createHLSRendition('input.mp4', 'output.m3u8', {
        name: '360p',
        resolution: '640x360',
        videoBitrate: '',
        audioBitrate: '64k',
    }), /Invalid HLS rendition configuration/);
    await assert.rejects(() => createHLSRendition('input.mp4', 'output.m3u8', {
        name: '360p',
        resolution: '640x360',
        videoBitrate: '600k',
        audioBitrate: '',
    }), /Invalid HLS rendition configuration/);
});

test('media tool status respects custom FFMPEG_PATH and FFPROBE_PATH environment variables', () => {
    const prevFfmpeg = process.env.FFMPEG_PATH;
    const prevFfprobe = process.env.FFPROBE_PATH;
    try {
        process.env.FFMPEG_PATH = 'nonexistent-ffmpeg-binary-test';
        process.env.FFPROBE_PATH = 'nonexistent-ffprobe-binary-test';
        const status = getMediaToolStatus();
        assert.equal(status.ffmpeg, false);
        assert.equal(status.ffprobe, false);
    } finally {
        if (prevFfmpeg === undefined) delete process.env.FFMPEG_PATH;
        else process.env.FFMPEG_PATH = prevFfmpeg;
        if (prevFfprobe === undefined) delete process.env.FFPROBE_PATH;
        else process.env.FFPROBE_PATH = prevFfprobe;
    }
});

test('UnrecoverableError is immediately treated as a terminal worker attempt', () => {
    const job = {
        attemptsMade: 0,
        opts: { attempts: 3 },
    } as unknown as Job;
    assert.equal(isTerminalAttempt(job, new Error('transient network timeout')), false);
    assert.equal(isTerminalAttempt(job, new UnrecoverableError('invalid media container')), true);
});

test('real FFmpeg pipeline handles audio+video MP4 and sub-second silent Short inside spaced temp path', async (t) => {
    const tools = getMediaToolStatus();
    if (!tools.ffmpeg || !tools.ffprobe) {
        t.skip('ffmpeg/ffprobe unavailable');
        return;
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt worker test '));
    try {
        // 1. Standard 2s AV MP4
        const avClip = path.join(workDir, 'av.mp4');
        execFileSync('ffmpeg', [
            '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=2',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', avClip,
        ], { stdio: 'ignore' });

        const avMeta = await getVideoMetadata(avClip);
        assert.equal(avMeta.streams.some((s) => s.codec_type === 'video'), true);
        assert.equal(avMeta.streams.some((s) => s.codec_type === 'audio'), true);

        const avOutDir = path.join(workDir, 'av out');
        await extractPoster(avClip, avOutDir, '1280x720', '00:00:01');
        await extractThumbnails(avClip, avOutDir, ['25%', '50%', '75%'], '1280x720');
        await createHLSRendition(
            avClip,
            path.join(avOutDir, '360p.m3u8'),
            { name: '360p', resolution: '640x360', videoBitrate: '600k', audioBitrate: '64k', bitrate: 600000 },
            { hasAudio: true },
        );
        const avFiles = await fs.readdir(avOutDir);
        assert.ok(avFiles.includes('poster.jpg'));
        assert.ok(avFiles.includes('360p.m3u8'));
        assert.ok(avFiles.some((f) => f.startsWith('360p_') && f.endsWith('.ts')));

        // 2. Sub-second (0.5s) silent portrait Short
        const shortClip = path.join(workDir, 'short-silent.mp4');
        execFileSync('ffmpeg', [
            '-y', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=24:duration=0.5',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shortClip,
        ], { stdio: 'ignore' });

        const shortMeta = await getVideoMetadata(shortClip);
        assert.equal(shortMeta.streams.some((s) => s.codec_type === 'video'), true);
        assert.equal(shortMeta.streams.some((s) => s.codec_type === 'audio'), false);

        const shortOutDir = path.join(workDir, 'short out');
        await extractPoster(shortClip, shortOutDir, '360x640', '0');
        await createHLSRendition(
            shortClip,
            path.join(shortOutDir, '540p.m3u8'),
            { name: '540p', resolution: '540x960', videoBitrate: '1800k', audioBitrate: '128k', bitrate: 1800000 },
            { hasAudio: false },
        );
        const shortFiles = await fs.readdir(shortOutDir);
        assert.ok(shortFiles.includes('poster.jpg'));
        assert.ok(shortFiles.includes('540p.m3u8'));
        assert.ok(shortFiles.some((f) => f.startsWith('540p_') && f.endsWith('.ts')));
        const shortM3u8 = await fs.readFile(path.join(shortOutDir, '540p.m3u8'), 'utf8');
        assert.match(shortM3u8, /^#EXTM3U/m);
        assert.match(shortM3u8, /^540p_000\.ts$/m);
    } finally {
        await fs.rm(workDir, { recursive: true, force: true });
    }
});
