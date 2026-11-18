import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { basename } from 'node:path';
import { decryptFile, encryptReadable, isWithin, sha256File } from './core.mjs';

const requireFromApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = requireFromApi('@aws-sdk/client-s3');
const { NodeHttpHandler } = requireFromApi('@smithy/node-http-handler');

function requestHandler() {
  return new NodeHttpHandler({ connectionTimeout: 15_000, socketTimeout: 120_000 });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for this operation.`);
  return value;
}

function sourceConfig() {
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const accessKeyId = requiredEnv('R2_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv('R2_SECRET_ACCESS_KEY');
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    region: 'auto',
    maxAttempts: 5,
    forcePathStyle: true,
    requestHandler: requestHandler(),
  };
}

export function sourceBuckets() {
  const raw = process.env.R2_BUCKET_RAW || 'watchtube-raw-uploads';
  const publicBucket = process.env.R2_BUCKET_PUBLIC || 'watchtube-media-public';
  return [...new Set([raw, publicBucket])];
}

export function createSourceClient() {
  return new S3Client(sourceConfig());
}

function classifyPrefix(key) {
  const slash = key.indexOf('/');
  const prefix = slash < 0 ? '(root)' : key.slice(0, slash);
  return createHash('sha256').update(prefix).digest('hex').slice(0, 16);
}

export async function* listObjects(client, bucket, signal) {
  let continuationToken;
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }), signal ? { abortSignal: signal } : undefined);
    for (const object of response.Contents || []) {
      if (typeof object.Key === 'string') yield object;
    }
    if (response.IsTruncated && !response.NextContinuationToken) {
      throw new Error(`Object listing for bucket ${bucket} was truncated without a continuation token.`);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
}

export async function inventoryMedia(client = createSourceClient(), buckets = sourceBuckets(), signal) {
  const inventory = [];
  for (const bucket of buckets) {
    const summary = {
      bucket,
      objectCount: 0,
      totalBytes: 0,
      byPrefix: {},
      largestObjects: [],
    };
    for await (const object of listObjects(client, bucket, signal)) {
      const size = Number(object.Size || 0);
      summary.objectCount += 1;
      summary.totalBytes += size;
      const prefix = classifyPrefix(object.Key);
      const prefixSummary = summary.byPrefix[prefix] || { objectCount: 0, totalBytes: 0 };
      prefixSummary.objectCount += 1;
      prefixSummary.totalBytes += size;
      summary.byPrefix[prefix] = prefixSummary;
      summary.largestObjects.push({ keySha256: createHash('sha256').update(object.Key).digest('hex'), sizeBytes: size });
      summary.largestObjects.sort((a, b) => b.sizeBytes - a.sizeBytes);
      summary.largestObjects.length = Math.min(summary.largestObjects.length, 10);
    }
    inventory.push(summary);
  }
  return inventory;
}

function keyDigest(key) {
  return createHash('sha256').update(key).digest('hex');
}

export async function backupMedia(client, runDir, key, buckets, writeManifest, signal) {
  const summaries = [];
  for (const bucket of buckets) {
    const bucketId = createHash('sha256').update(bucket).digest('hex').slice(0, 16);
    const summary = { bucket, objectCount: 0, totalBytes: 0 };
    for await (const object of listObjects(client, bucket, signal)) {
      const objectKey = object.Key;
      if (objectKey === undefined) continue;
      const objectId = keyDigest(objectKey);
      const relativePath = path.posix.join('media', bucketId, objectId.slice(0, 2), `${objectId}.wtbk`);
      const outputPath = path.join(runDir, relativePath);
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
        signal ? { abortSignal: signal } : undefined,
      );
      if (!response.Body) throw new Error(`Object download from bucket ${bucket} returned no content.`);
      const encrypted = await encryptReadable(response.Body, outputPath, key, { signal });
      if (response.ContentLength !== undefined && response.ContentLength !== encrypted.plainSizeBytes) {
        throw new Error(`Downloaded object size did not match the listed object in bucket ${bucket}.`);
      }
      if (object.Size !== undefined && object.Size !== encrypted.plainSizeBytes) {
        throw new Error(`Downloaded object changed during backup in bucket ${bucket}.`);
      }
      if (object.ETag && response.ETag
          && object.ETag.replaceAll('"', '') !== response.ETag.replaceAll('"', '')) {
        throw new Error(`Downloaded object version changed during backup in bucket ${bucket}.`);
      }
      await writeManifest({
        type: 'media-object',
        bucket,
        key: objectKey,
        relativePath,
        plainSizeBytes: encrypted.plainSizeBytes,
        plainSha256: encrypted.plainSha256,
        encryptedSizeBytes: encrypted.encryptedSizeBytes,
        encryptedSha256: encrypted.encryptedSha256,
        etag: response.ETag || object.ETag || null,
        lastModified: object.LastModified ? object.LastModified.toISOString() : null,
      });
      summary.objectCount += 1;
      summary.totalBytes += encrypted.plainSizeBytes;
    }
    summaries.push(summary);
  }
  return summaries;
}

async function* enumerateFiles(rootDir, currentDir = rootDir) {
  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Backup contains a symbolic link; remote mirroring was stopped.');
    if (entry.isDirectory()) {
      yield* enumerateFiles(rootDir, fullPath);
    } else if (entry.isFile()) {
      yield { fullPath, relativePath: path.relative(rootDir, fullPath) };
    } else {
      throw new Error('Backup contains an unsupported filesystem entry; remote mirroring was stopped.');
    }
  }
}

function destinationClient() {
  const endpointText = requiredEnv('BACKUP_S3_ENDPOINT');
  let endpoint;
  try {
    endpoint = new URL(endpointText);
  } catch {
    throw new Error('BACKUP_S3_ENDPOINT must be a valid HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
      || endpoint.search || endpoint.hash) {
    throw new Error('BACKUP_S3_ENDPOINT must be an HTTPS URL without embedded credentials or query values.');
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (accountId && endpoint.hostname === `${accountId}.r2.cloudflarestorage.com`) {
    throw new Error('The backup destination must not use the same Cloudflare R2 account as the source.');
  }
  const client = new S3Client({
    endpoint: endpoint.toString().replace(/\/$/, ''),
    region: process.env.BACKUP_S3_REGION || 'auto',
    credentials: {
      accessKeyId: requiredEnv('BACKUP_S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('BACKUP_S3_SECRET_ACCESS_KEY'),
    },
    maxAttempts: 5,
    forcePathStyle: true,
    requestHandler: requestHandler(),
  });
  return { client, bucket: requiredEnv('BACKUP_S3_BUCKET') };
}

export async function mirrorBackup(runDir, runId, signal) {
  const { client, bucket } = destinationClient();
  try {
    const prefix = `watchtube-backups/${runId}/`;
    const existing = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1,
    }), signal ? { abortSignal: signal } : undefined);
    if ((existing.Contents || []).length > 0) {
      throw new Error('The remote backup prefix already exists; refusing to overwrite it.');
    }
    let fileCount = 0;
    for await (const file of enumerateFiles(runDir)) {
      if (basename(file.relativePath) === '.complete') continue;
      const fileStat = await stat(file.fullPath);
      const digest = await sha256File(file.fullPath);
      const key = `${prefix}${file.relativePath.split(path.sep).join('/')}`;
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(file.fullPath),
        ContentLength: fileStat.size,
        ChecksumSHA256: Buffer.from(digest.sha256, 'hex').toString('base64'),
        Metadata: { sha256: digest.sha256 },
        IfNoneMatch: '*',
      }), signal ? { abortSignal: signal } : undefined);
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
        signal ? { abortSignal: signal } : undefined,
      );
      if (head.ContentLength !== fileStat.size || head.Metadata?.sha256 !== digest.sha256) {
        throw new Error('Remote backup verification failed after upload.');
      }
      fileCount += 1;
    }
    const markerPath = path.join(runDir, '.complete');
    const markerStat = await stat(markerPath);
    const markerDigest = await sha256File(markerPath);
    const markerKey = `${prefix}.complete`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: markerKey,
      Body: createReadStream(markerPath),
      ContentLength: markerStat.size,
      ChecksumSHA256: Buffer.from(markerDigest.sha256, 'hex').toString('base64'),
      Metadata: { sha256: markerDigest.sha256 },
      IfNoneMatch: '*',
    }), signal ? { abortSignal: signal } : undefined);
    const markerHead = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: markerKey }),
      signal ? { abortSignal: signal } : undefined,
    );
    if (markerHead.ContentLength !== markerStat.size || markerHead.Metadata?.sha256 !== markerDigest.sha256) {
      throw new Error('Remote completion marker verification failed.');
    }
    return { bucket, prefix, fileCount: fileCount + 1 };
  } finally {
    client.destroy();
  }
}

export async function restoreMediaObjects({ runDir, key, runId, records, buckets, signal }) {
  const endpointText = requiredEnv('RESTORE_S3_ENDPOINT');
  let endpoint;
  try {
    endpoint = new URL(endpointText);
  } catch {
    throw new Error('RESTORE_S3_ENDPOINT must be a valid HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
      || endpoint.search || endpoint.hash) {
    throw new Error('RESTORE_S3_ENDPOINT must be an HTTPS URL without embedded credentials or query values.');
  }
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  if (endpoint.hostname === `${accountId}.r2.cloudflarestorage.com`) {
    throw new Error('Media restore tests must target a different Cloudflare R2 account.');
  }
  const bucket = requiredEnv('RESTORE_S3_BUCKET');
  const client = new S3Client({
    endpoint: endpoint.toString().replace(/\/$/, ''),
    region: process.env.RESTORE_S3_REGION || 'auto',
    credentials: {
      accessKeyId: requiredEnv('RESTORE_S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('RESTORE_S3_SECRET_ACCESS_KEY'),
    },
    maxAttempts: 5,
    forcePathStyle: true,
    requestHandler: requestHandler(),
  });
  const prefix = `watchtube-restore-tests/${runId}/`;
  let restored = 0;
  let restoredBytes = 0;
  try {
    const existing = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1,
    }), signal ? { abortSignal: signal } : undefined);
    if ((existing.Contents || []).length > 0) {
      throw new Error('The isolated media restore prefix already exists; refusing to overwrite it.');
    }
    for await (const record of records) {
      if (record.type !== 'media-object') continue;
      if (!buckets.includes(record.bucket) || typeof record.key !== 'string'
          || typeof record.relativePath !== 'string' || record.relativePath.includes('\\')
          || path.posix.isAbsolute(record.relativePath)) {
        throw new Error('Backup manifest contains an invalid media restore record.');
      }
      const encryptedPath = path.resolve(runDir, ...record.relativePath.split('/'));
      if (!isWithin(runDir, encryptedPath) || encryptedPath === runDir) {
        throw new Error('Backup manifest media path escapes the backup directory.');
      }
      const tempPath = path.join(os.tmpdir(), `watchtube-media-restore-${randomUUID()}.bin`);
      try {
        await decryptFile(encryptedPath, tempPath, key, record, { signal });
        const keyPath = `${prefix}${record.bucket}/${record.key}`;
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: keyPath,
          Body: createReadStream(tempPath),
          ContentLength: record.plainSizeBytes,
          ChecksumSHA256: Buffer.from(record.plainSha256, 'hex').toString('base64'),
          Metadata: { sha256: record.plainSha256 },
          IfNoneMatch: '*',
        }), signal ? { abortSignal: signal } : undefined);
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: keyPath }),
          signal ? { abortSignal: signal } : undefined,
        );
        if (head.ContentLength !== record.plainSizeBytes
            || head.Metadata?.sha256 !== record.plainSha256) {
          throw new Error('Restored media object failed remote verification.');
        }
      } finally {
        await rm(tempPath, { force: true });
      }
      restored += 1;
      restoredBytes += record.plainSizeBytes;
    }

    const marker = Buffer.from(JSON.stringify({
      runId,
      restoredObjects: restored,
      restoredBytes,
      completedAt: new Date().toISOString(),
    }));
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}.complete`,
      Body: marker,
      ContentLength: marker.length,
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }), signal ? { abortSignal: signal } : undefined);
    const completeHead = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: `${prefix}.complete` }),
      signal ? { abortSignal: signal } : undefined,
    );
    if (completeHead.ContentLength !== marker.length) {
      throw new Error('Media restore completion marker failed verification.');
    }
    return { bucket, prefix, restoredObjects: restored, restoredBytes };
  } finally {
    client.destroy();
  }
}
