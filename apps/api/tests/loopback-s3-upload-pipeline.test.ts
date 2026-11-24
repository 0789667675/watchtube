import assert from 'node:assert/strict';
import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';
import sharp from 'sharp';
import {
  createVideoThumbnailUploadTarget,
  generatePresignedUploadUrl,
  inspectRawObject,
  normalizeUploadedVideoThumbnail,
} from '../src/services/storage.service';

interface StoredObject {
  body: Buffer;
  contentType: string;
  contentLength: number;
}

let s3Server: Server | null = null;
let s3Port = 0;
const storageStore = new Map<string, StoredObject>();

function startLoopbackS3Server(): Promise<number> {
  return new Promise((resolve) => {
    storageStore.clear();
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${s3Port}`);
      const rawPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      // Format in path-style: <bucket>/<key...>
      const slashIndex = rawPath.indexOf('/');
      const key = slashIndex >= 0 ? rawPath.slice(slashIndex + 1) : rawPath;

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, HEAD, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        });
        res.end();
        return;
      }

      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const contentType = req.headers['content-type'] || 'application/octet-stream';
          storageStore.set(key, {
            body,
            contentType,
            contentLength: body.length,
          });
          res.writeHead(200, {
            'ETag': '"mock-etag-12345"',
            'Access-Control-Allow-Origin': '*',
          });
          res.end();
        });
        return;
      }

      if (req.method === 'HEAD') {
        const obj = storageStore.get(key);
        if (!obj) {
          res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': obj.contentType,
          'Content-Length': String(obj.contentLength),
          'ETag': '"mock-etag-12345"',
          'Access-Control-Allow-Origin': '*',
        });
        res.end();
        return;
      }

      if (req.method === 'GET') {
        const obj = storageStore.get(key);
        if (!obj) {
          res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': obj.contentType,
          'Content-Length': String(obj.contentLength),
          'ETag': '"mock-etag-12345"',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(obj.body);
        return;
      }

      if (req.method === 'DELETE') {
        storageStore.delete(key);
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return;
      }

      res.writeHead(405);
      res.end();
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      s3Port = address.port;
      s3Server = server;
      resolve(address.port);
    });
  });
}

const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  'NODE_ENV',
  'WATCHTUBE_TEST_S3_ENDPOINT',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_RAW',
  'R2_BUCKET_PUBLIC',
  'R2_PUBLIC_DOMAIN',
];

beforeEach(async () => {
  for (const k of envKeys) {
    savedEnv[k] = process.env[k];
  }
  const port = await startLoopbackS3Server();
  process.env.NODE_ENV = 'test';
  process.env.WATCHTUBE_TEST_S3_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
  process.env.R2_ACCESS_KEY_ID = 'loopback-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'loopback-secret-key';
  process.env.R2_BUCKET_RAW = 'watchtube-raw-uploads';
  process.env.R2_BUCKET_PUBLIC = 'watchtube-media-public';
  process.env.R2_PUBLIC_DOMAIN = 'https://media.watchtube.test';
});

afterEach(async () => {
  if (s3Server) {
    await new Promise<void>((resolve) => s3Server!.close(() => resolve()));
    s3Server = null;
  }
  storageStore.clear();
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

test('Loopback S3: Video-only upload transfers successfully with host-only signed headers', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const dummyVideoPayload = Buffer.from('FAKE-MP4-VIDEO-CONTENT-HEADER-TO-FOOTER-BYTES-12345');
  const contentType = 'video/mp4';

  const intent = await generatePresignedUploadUrl(userId, contentType, dummyVideoPayload.length);
  assert.ok(intent.uploadUrl);
  assert.ok(intent.fileKey.startsWith(`uploads/${userId}/`));

  // Verify that signed headers do NOT include content-length
  const parsedUrl = new URL(intent.uploadUrl);
  assert.equal(parsedUrl.searchParams.get('X-Amz-SignedHeaders'), 'host');

  // Client uploads directly via HTTP PUT to the loopback S3 URL
  const uploadResponse = await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: dummyVideoPayload,
  });
  assert.equal(uploadResponse.status, 200);

  // Server-side inspection via HeadObject
  const inspected = await inspectRawObject(intent.fileKey);
  assert.ok(inspected);
  assert.equal(inspected.contentLength, dummyVideoPayload.length);
  assert.equal(inspected.contentType, contentType);
});

test('Loopback S3: Video-plus-thumbnail upload transfers and normalizes custom thumbnail to WebP', async () => {
  const videoId = '22222222-2222-4222-8222-222222222222';
  // Generate a valid PNG image using Sharp
  const pngBuffer = await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 3,
      background: { r: 50, g: 120, b: 220 },
    },
  }).png().toBuffer();

  const target = await createVideoThumbnailUploadTarget(videoId, 'image/png', pngBuffer.length);
  assert.ok(target.uploadUrl);
  assert.ok(target.storageKey.startsWith(`processing/${videoId}/`));

  const parsedUrl = new URL(target.uploadUrl);
  assert.equal(parsedUrl.searchParams.get('X-Amz-SignedHeaders'), 'host');

  // Client uploads the thumbnail image
  const uploadResponse = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: pngBuffer,
  });
  assert.equal(uploadResponse.status, 200);

  // Server-side normalization fetches raw object and writes WebP
  const normalized = await normalizeUploadedVideoThumbnail(
    target.storageKey,
    'image/png',
    pngBuffer.length,
    false,
  );
  assert.equal(normalized, true);

  // Confirm the object now exists in storage as WebP
  const inspected = await inspectRawObject(target.storageKey);
  assert.ok(inspected);
  assert.equal(inspected.contentType, 'image/webp');
  assert.ok(inspected.contentLength! > 0);
});

test('Loopback S3: Server inspectRawObject accurately identifies missing objects', async () => {
  const nonExistentKey = 'uploads/11111111-1111-4111-8111-111111111111/missing-file.mp4';
  const inspected = await inspectRawObject(nonExistentKey);
  assert.equal(inspected, null);
});
