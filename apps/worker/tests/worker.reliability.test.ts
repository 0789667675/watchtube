import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Job } from 'bullmq';
import {
    getPublicDomain,
    getWorkerOptions,
    isTerminalAttempt,
    markVideoFailedIfProcessing,
    markVideoReadyForReview,
    shutdownWorker,
} from '../src/worker';
import {
    downloadRawVideo,
    getStorageConfigurationStatus,
} from '../src/services/storage.service';
import { createHLSRendition, extractPoster, extractThumbnails, getVideoMetadata } from '../src/services/transcode.service';
import { assertSafeWorkerEndpoints } from '../src/serviceEndpointSafety';

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
        attemptsMade: 2,
        opts: { attempts: 3 },
    } as unknown as Job;
    assert.equal(isTerminalAttempt(job), true);

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
    await assert.rejects(() => createHLSRendition('input.mp4', 'output.m3u8', {
        name: '360p',
        resolution: '',
        videoBitrate: '600k',
        audioBitrate: '64k',
    }), /Invalid HLS rendition configuration/);
});
