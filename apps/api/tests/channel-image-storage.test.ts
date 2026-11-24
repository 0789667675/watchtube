import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createChannelImageStorageService } from '../src/services/storage.service';
import type {
  ChannelImageConfirmationInput,
  ChannelImageStorageAdapter,
} from '../src/services/storage.service';
import { InvalidChannelImageError } from '../src/services/channel-image.service';
import { StorageUnavailableError } from '../src/services/storage.service';

const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const UPLOAD_ID = '55555555-5555-4555-8555-555555555555';

interface StorageHarness {
  storage: ReturnType<typeof createChannelImageStorageService>;
  calls: {
    signedTargets: Array<{ bucket: string; key: string; contentType: string; fileSize: number; expiresIn: number }>;
    metadataReads: Array<{ bucket: string; key: string }>;
    objectReads: Array<{ bucket: string; key: string; maxBytes: number }>;
    publicWrites: Array<{
      bucket: string;
      key: string;
      body: Buffer;
      contentType: string;
      cacheControl: string;
    }>;
    metadata: { contentLength?: number; contentType?: string } | null;
    bytes: Buffer | null;
  };
}

async function createHarness(bytes: Buffer): Promise<StorageHarness> {
  const calls: StorageHarness['calls'] = {
    signedTargets: [],
    metadataReads: [],
    objectReads: [],
    publicWrites: [],
    metadata: { contentLength: bytes.length, contentType: 'image/png' },
    bytes,
  };
  const adapter: ChannelImageStorageAdapter = {
    createSignedUploadUrl: async (input) => {
      calls.signedTargets.push(input);
      return 'https://upload.example/presigned';
    },
    getObjectMetadata: async (bucket, key) => {
      calls.metadataReads.push({ bucket, key });
      return calls.metadata;
    },
    getObjectBytes: async (bucket, key, maxBytes) => {
      calls.objectReads.push({ bucket, key, maxBytes });
      return calls.bytes;
    },
    putPublicObject: async (input) => {
      calls.publicWrites.push(input);
    },
  };
  const storage = createChannelImageStorageService(adapter, {
    rawBucket: 'private-raw',
    publicBucket: 'existing-public',
    publicDomain: 'https://media.example',
  });
  return { storage, calls };
}

async function validAvatarPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 128,
      height: 128,
      channels: 3,
      background: { r: 40, g: 100, b: 200 },
    },
  }).png().toBuffer();
}

const confirmation: ChannelImageConfirmationInput = {
  channelId: CHANNEL_ID,
  purpose: 'avatar',
  contentType: 'image/png',
  fileSize: 1,
  uploadId: UPLOAD_ID,
};

test('upload target uses a unique server-generated channel-image key in the private bucket', async () => {
  const { storage, calls } = await createHarness(await validAvatarPng());
  const input = {
    channelId: CHANNEL_ID,
    purpose: 'avatar' as const,
    contentType: 'image/png',
    fileSize: 2048,
  };
  const first = await storage.createUploadTarget(input);
  const second = await storage.createUploadTarget(input);

  assert.equal(first.uploadUrl, 'https://upload.example/presigned');
  assert.equal(first.expiresIn, 900);
  assert.notEqual(first.uploadId, second.uploadId);
  assert.match(calls.signedTargets[0].key, new RegExp(`^channel-image-uploads/${CHANNEL_ID}/avatar/`));
  assert.equal(calls.signedTargets[0].bucket, 'private-raw');
  assert.equal(calls.signedTargets[0].contentType, 'image/png');
  assert.equal(calls.signedTargets[0].fileSize, 2048);
});

test('upload target rejects unsupported media types and oversized files', async () => {
  const { storage, calls } = await createHarness(await validAvatarPng());
  await assert.rejects(
    storage.createUploadTarget({
      channelId: CHANNEL_ID,
      purpose: 'avatar',
      contentType: 'image/svg+xml',
      fileSize: 1024,
    }),
    InvalidChannelImageError,
  );
  await assert.rejects(
    storage.createUploadTarget({
      channelId: CHANNEL_ID,
      purpose: 'banner',
      contentType: 'image/png',
      fileSize: 10 * 1024 * 1024 + 1,
    }),
    InvalidChannelImageError,
  );
  assert.equal(calls.signedTargets.length, 0);
});

test('confirmation checks uploaded object metadata, decodes it, and writes a normalized public WebP', async () => {
  const bytes = await validAvatarPng();
  const { storage, calls } = await createHarness(bytes);
  const publicUrl = await storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length });

  assert.match(
    publicUrl ?? '',
    new RegExp(`^https://media\\.example/channel-images/${CHANNEL_ID}/avatar/[0-9a-f-]+\\.webp$`, 'i'),
  );
  assert.deepEqual(calls.metadataReads, [{
    bucket: 'private-raw',
    key: `channel-image-uploads/${CHANNEL_ID}/avatar/${UPLOAD_ID}`,
  }]);
  assert.deepEqual(calls.objectReads, [{
    bucket: 'private-raw',
    key: `channel-image-uploads/${CHANNEL_ID}/avatar/${UPLOAD_ID}`,
    maxBytes: bytes.length,
  }]);
  assert.equal(calls.publicWrites.length, 1);
  const write = calls.publicWrites[0];
  assert.equal(write.bucket, 'existing-public');
  assert.match(write.key, new RegExp(`^channel-images/${CHANNEL_ID}/avatar/[0-9a-f-]+\\.webp$`, 'i'));
  assert.equal(write.contentType, 'image/webp');
  assert.equal(write.cacheControl, 'public, max-age=31536000, immutable');
  const outputMetadata = await sharp(write.body).metadata();
  assert.equal(outputMetadata.format, 'webp');
  assert.equal(outputMetadata.width, 512);
  assert.equal(outputMetadata.height, 512);
});

test('confirmation rejects uploaded metadata that differs from the authorized request', async () => {
  const bytes = await validAvatarPng();
  const { storage, calls } = await createHarness(bytes);
  calls.metadata = { contentLength: bytes.length + 1, contentType: 'image/png' };

  await assert.rejects(
    storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length }),
    InvalidChannelImageError,
  );
  assert.equal(calls.objectReads.length, 0);
  assert.equal(calls.publicWrites.length, 0);
});

test('confirmation rejects a body that exceeds its authorized size and malformed upload IDs', async () => {
  const bytes = await validAvatarPng();
  const { storage, calls } = await createHarness(bytes);
  calls.bytes = Buffer.concat([bytes, Buffer.from('extra')]);

  await assert.rejects(
    storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length }),
    InvalidChannelImageError,
  );
  assert.equal(calls.publicWrites.length, 0);

  await assert.rejects(
    storage.publishUploadedImage({ ...confirmation, uploadId: '../other-channel', fileSize: bytes.length }),
    InvalidChannelImageError,
  );
  assert.equal(calls.metadataReads.length, 1);
});

test('confirmation rejects missing objects without creating public media', async () => {
  const { storage, calls } = await createHarness(await validAvatarPng());
  calls.metadata = null;
  const result = await storage.publishUploadedImage({ ...confirmation, fileSize: 1024 });

  assert.equal(result, null);
  assert.equal(calls.objectReads.length, 0);
  assert.equal(calls.publicWrites.length, 0);
});

test('confirmation rejects invalid image bytes even when storage metadata claims PNG', async () => {
  const { storage, calls } = await createHarness(Buffer.from('not an image'));
  calls.metadata = { contentLength: 12, contentType: 'image/png' };

  await assert.rejects(
    storage.publishUploadedImage({ ...confirmation, fileSize: 12 }),
    InvalidChannelImageError,
  );
  assert.equal(calls.publicWrites.length, 0);
});

test('unsupported public media URL configuration is rejected before any object is written', async () => {
  const bytes = await validAvatarPng();
  const publicWrites: Array<{
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
  }> = [];
  const adapter: ChannelImageStorageAdapter = {
    createSignedUploadUrl: async () => 'https://upload.example/presigned',
    getObjectMetadata: async () => ({ contentLength: bytes.length, contentType: 'image/png' }),
    getObjectBytes: async () => bytes,
    putPublicObject: async (input) => { publicWrites.push(input); },
  };
  const insecureStorage = createChannelImageStorageService(adapter, {
    rawBucket: 'private-raw',
    publicBucket: 'existing-public',
    publicDomain: 'ftp://media.example',
  });

  await assert.rejects(
    insecureStorage.publishUploadedImage({ ...confirmation, fileSize: bytes.length }),
    /Public media URL configuration is invalid/,
  );
  assert.equal(publicWrites.length, 0);
});

test('missing public media URL reports configuration names before creating an upload target', async () => {
  const bytes = await validAvatarPng();
  const { calls } = await createHarness(bytes);
  const storage = createChannelImageStorageService({
    async createSignedUploadUrl(input) {
      calls.signedTargets.push(input);
      return 'https://upload.example/presigned';
    },
    async getObjectMetadata() { return null; },
    async getObjectBytes() { return null; },
    async putPublicObject(input) { calls.publicWrites.push(input); },
  }, {
    rawBucket: 'private-raw',
    publicBucket: 'existing-public',
    publicDomain: 'your_public_domain',
  });

  await assert.rejects(
    storage.createUploadTarget({
      channelId: CHANNEL_ID,
      purpose: 'avatar',
      contentType: 'image/png',
      fileSize: 1024,
    }),
    (error: unknown) => {
      assert.ok(error instanceof StorageUnavailableError);
      assert.match(error.message, /R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL/);
      return true;
    },
  );
  assert.equal(calls.signedTargets.length, 0);
});

test('HTTP public domain configuration is served over HTTPS like the video worker', async () => {
  const bytes = await validAvatarPng();
  const publicWrites: Array<{
    bucket: string;
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
  }> = [];
  const adapter: ChannelImageStorageAdapter = {
    createSignedUploadUrl: async () => 'https://upload.example/presigned',
    getObjectMetadata: async () => ({ contentLength: bytes.length, contentType: 'image/png' }),
    getObjectBytes: async () => bytes,
    putPublicObject: async (input) => { publicWrites.push(input); },
  };
  const storage = createChannelImageStorageService(adapter, {
    rawBucket: 'private-raw',
    publicBucket: 'existing-public',
    publicDomain: 'http://media.example',
  });

  const publicUrl = await storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length });
  assert.match(publicUrl ?? '', /^https:\/\/media\.example\/channel-images\//);
  assert.equal(publicWrites.length, 1);
});
