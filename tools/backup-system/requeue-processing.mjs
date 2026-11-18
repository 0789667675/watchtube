import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactedErrorMessage } from './core.mjs';
import { parseDatabaseUrl } from './postgres.mjs';
import { createSourceClient } from './storage.mjs';
import { recoverProcessingVideos } from './queue-recovery-core.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFromWorker = createRequire(path.join(REPO_ROOT, 'apps', 'worker', 'package.json'));
const requireFromApi = createRequire(path.join(REPO_ROOT, 'apps', 'api', 'package.json'));
const { Queue } = requireFromWorker('bullmq');
const IORedis = requireFromWorker('ioredis');
const { db } = requireFromWorker('@watchtube/database');
const { HeadObjectCommand } = requireFromApi('@aws-sdk/client-s3');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function assertLocalRedis() {
  if (process.env.REDIS_URL) {
    let redisUrl;
    try {
      redisUrl = new URL(process.env.REDIS_URL);
    } catch {
      throw new Error('REDIS_URL is invalid.');
    }
    const host = redisUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['redis:', 'rediss:'].includes(redisUrl.protocol)
        || !LOCAL_HOSTS.has(host)) {
      throw new Error('Queue recovery is restricted to a loopback Redis instance.');
    }
    return new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  const host = process.env.REDIS_HOST || '127.0.0.1';
  if (!LOCAL_HOSTS.has(host.toLowerCase())) {
    throw new Error('Queue recovery is restricted to a loopback Redis instance.');
  }
  const port = Number(process.env.REDIS_PORT || 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_PORT is invalid.');
  }
  return new IORedis({ host, port, maxRetriesPerRequest: null });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && process.env.WATCHTUBE_REQUEUE_PROCESSING !== '1') {
    throw new Error('Set WATCHTUBE_REQUEUE_PROCESSING=1 to enable this local recovery operation.');
  }
  const database = parseDatabaseUrl(process.env.DATABASE_URL);
  if (!LOCAL_HOSTS.has(database.host.toLowerCase().replace(/^\[|\]$/g, ''))) {
    throw new Error('Queue recovery is restricted to a loopback PostgreSQL instance.');
  }

  if (!dryRun && process.env.WATCHTUBE_REQUEUE_STORAGE_ISOLATED !== '1') {
    throw new Error('Mutating recovery requires WATCHTUBE_REQUEUE_STORAGE_ISOLATED=1 after confirming worker media credentials are non-production.');
  }
  const redis = assertLocalRedis();
  const queue = new Queue('video-transcode', { connection: redis });
  const storage = createSourceClient();
  try {
    const videos = await db.video.findMany({
      where: { status: 'PROCESSING' },
      select: {
        id: true,
        rawStorageKey: true,
        channel: { select: { userId: true } },
      },
    });
    const result = await recoverProcessingVideos({
      videos,
      queue,
      dryRun,
      async hasRawObject(key) {
        try {
          await storage.send(new HeadObjectCommand({
            Bucket: process.env.R2_BUCKET_RAW || 'watchtube-raw-uploads',
            Key: key,
          }));
          return true;
        } catch (error) {
          if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound'
              || error?.name === 'NoSuchKey') {
            return false;
          }
          throw error;
        }
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    storage.destroy();
    await queue.close();
    await redis.quit();
    await db.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Queue recovery failed: ${redactedErrorMessage(error)}\n`);
  process.exitCode = 1;
});
