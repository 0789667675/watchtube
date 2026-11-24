"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const sharp_1 = __importDefault(require("sharp"));
const storage_service_1 = require("../src/services/storage.service");
const channel_image_service_1 = require("../src/services/channel-image.service");
const storage_service_2 = require("../src/services/storage.service");
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const UPLOAD_ID = '55555555-5555-4555-8555-555555555555';
async function createHarness(bytes) {
    const calls = {
        signedTargets: [],
        metadataReads: [],
        objectReads: [],
        publicWrites: [],
        metadata: { contentLength: bytes.length, contentType: 'image/png' },
        bytes,
    };
    const adapter = {
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
    const storage = (0, storage_service_1.createChannelImageStorageService)(adapter, {
        rawBucket: 'private-raw',
        publicBucket: 'existing-public',
        publicDomain: 'https://media.example',
    });
    return { storage, calls };
}
async function validAvatarPng() {
    return (0, sharp_1.default)({
        create: {
            width: 128,
            height: 128,
            channels: 3,
            background: { r: 40, g: 100, b: 200 },
        },
    }).png().toBuffer();
}
const confirmation = {
    channelId: CHANNEL_ID,
    purpose: 'avatar',
    contentType: 'image/png',
    fileSize: 1,
    uploadId: UPLOAD_ID,
};
(0, node_test_1.test)('upload target uses a unique server-generated channel-image key in the private bucket', async () => {
    const { storage, calls } = await createHarness(await validAvatarPng());
    const input = {
        channelId: CHANNEL_ID,
        purpose: 'avatar',
        contentType: 'image/png',
        fileSize: 2048,
    };
    const first = await storage.createUploadTarget(input);
    const second = await storage.createUploadTarget(input);
    strict_1.default.equal(first.uploadUrl, 'https://upload.example/presigned');
    strict_1.default.equal(first.expiresIn, 900);
    strict_1.default.notEqual(first.uploadId, second.uploadId);
    strict_1.default.match(calls.signedTargets[0].key, new RegExp(`^channel-image-uploads/${CHANNEL_ID}/avatar/`));
    strict_1.default.equal(calls.signedTargets[0].bucket, 'private-raw');
    strict_1.default.equal(calls.signedTargets[0].contentType, 'image/png');
    strict_1.default.equal(calls.signedTargets[0].fileSize, 2048);
});
(0, node_test_1.test)('upload target rejects unsupported media types and oversized files', async () => {
    const { storage, calls } = await createHarness(await validAvatarPng());
    await strict_1.default.rejects(storage.createUploadTarget({
        channelId: CHANNEL_ID,
        purpose: 'avatar',
        contentType: 'image/svg+xml',
        fileSize: 1024,
    }), channel_image_service_1.InvalidChannelImageError);
    await strict_1.default.rejects(storage.createUploadTarget({
        channelId: CHANNEL_ID,
        purpose: 'banner',
        contentType: 'image/png',
        fileSize: 10 * 1024 * 1024 + 1,
    }), channel_image_service_1.InvalidChannelImageError);
    strict_1.default.equal(calls.signedTargets.length, 0);
});
(0, node_test_1.test)('confirmation checks uploaded object metadata, decodes it, and writes a normalized public WebP', async () => {
    const bytes = await validAvatarPng();
    const { storage, calls } = await createHarness(bytes);
    const publicUrl = await storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length });
    strict_1.default.match(publicUrl ?? '', new RegExp(`^https://media\\.example/channel-images/${CHANNEL_ID}/avatar/[0-9a-f-]+\\.webp$`, 'i'));
    strict_1.default.deepEqual(calls.metadataReads, [{
            bucket: 'private-raw',
            key: `channel-image-uploads/${CHANNEL_ID}/avatar/${UPLOAD_ID}`,
        }]);
    strict_1.default.deepEqual(calls.objectReads, [{
            bucket: 'private-raw',
            key: `channel-image-uploads/${CHANNEL_ID}/avatar/${UPLOAD_ID}`,
            maxBytes: bytes.length,
        }]);
    strict_1.default.equal(calls.publicWrites.length, 1);
    const write = calls.publicWrites[0];
    strict_1.default.equal(write.bucket, 'existing-public');
    strict_1.default.match(write.key, new RegExp(`^channel-images/${CHANNEL_ID}/avatar/[0-9a-f-]+\\.webp$`, 'i'));
    strict_1.default.equal(write.contentType, 'image/webp');
    strict_1.default.equal(write.cacheControl, 'public, max-age=31536000, immutable');
    const outputMetadata = await (0, sharp_1.default)(write.body).metadata();
    strict_1.default.equal(outputMetadata.format, 'webp');
    strict_1.default.equal(outputMetadata.width, 512);
    strict_1.default.equal(outputMetadata.height, 512);
});
(0, node_test_1.test)('confirmation rejects uploaded metadata that differs from the authorized request', async () => {
    const bytes = await validAvatarPng();
    const { storage, calls } = await createHarness(bytes);
    calls.metadata = { contentLength: bytes.length + 1, contentType: 'image/png' };
    await strict_1.default.rejects(storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length }), channel_image_service_1.InvalidChannelImageError);
    strict_1.default.equal(calls.objectReads.length, 0);
    strict_1.default.equal(calls.publicWrites.length, 0);
});
(0, node_test_1.test)('confirmation rejects a body that exceeds its authorized size and malformed upload IDs', async () => {
    const bytes = await validAvatarPng();
    const { storage, calls } = await createHarness(bytes);
    calls.bytes = Buffer.concat([bytes, Buffer.from('extra')]);
    await strict_1.default.rejects(storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length }), channel_image_service_1.InvalidChannelImageError);
    strict_1.default.equal(calls.publicWrites.length, 0);
    await strict_1.default.rejects(storage.publishUploadedImage({ ...confirmation, uploadId: '../other-channel', fileSize: bytes.length }), channel_image_service_1.InvalidChannelImageError);
    strict_1.default.equal(calls.metadataReads.length, 1);
});
(0, node_test_1.test)('confirmation rejects missing objects without creating public media', async () => {
    const { storage, calls } = await createHarness(await validAvatarPng());
    calls.metadata = null;
    const result = await storage.publishUploadedImage({ ...confirmation, fileSize: 1024 });
    strict_1.default.equal(result, null);
    strict_1.default.equal(calls.objectReads.length, 0);
    strict_1.default.equal(calls.publicWrites.length, 0);
});
(0, node_test_1.test)('confirmation rejects invalid image bytes even when storage metadata claims PNG', async () => {
    const { storage, calls } = await createHarness(Buffer.from('not an image'));
    calls.metadata = { contentLength: 12, contentType: 'image/png' };
    await strict_1.default.rejects(storage.publishUploadedImage({ ...confirmation, fileSize: 12 }), channel_image_service_1.InvalidChannelImageError);
    strict_1.default.equal(calls.publicWrites.length, 0);
});
(0, node_test_1.test)('unsupported public media URL configuration is rejected before any object is written', async () => {
    const bytes = await validAvatarPng();
    const publicWrites = [];
    const adapter = {
        createSignedUploadUrl: async () => 'https://upload.example/presigned',
        getObjectMetadata: async () => ({ contentLength: bytes.length, contentType: 'image/png' }),
        getObjectBytes: async () => bytes,
        putPublicObject: async (input) => { publicWrites.push(input); },
    };
    const insecureStorage = (0, storage_service_1.createChannelImageStorageService)(adapter, {
        rawBucket: 'private-raw',
        publicBucket: 'existing-public',
        publicDomain: 'ftp://media.example',
    });
    await strict_1.default.rejects(insecureStorage.publishUploadedImage({ ...confirmation, fileSize: bytes.length }), /Public media URL configuration is invalid/);
    strict_1.default.equal(publicWrites.length, 0);
});
(0, node_test_1.test)('missing public media URL reports configuration names before creating an upload target', async () => {
    const bytes = await validAvatarPng();
    const { calls } = await createHarness(bytes);
    const storage = (0, storage_service_1.createChannelImageStorageService)({
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
    await strict_1.default.rejects(storage.createUploadTarget({
        channelId: CHANNEL_ID,
        purpose: 'avatar',
        contentType: 'image/png',
        fileSize: 1024,
    }), (error) => {
        strict_1.default.ok(error instanceof storage_service_2.StorageUnavailableError);
        strict_1.default.match(error.message, /R2_PUBLIC_DOMAIN or R2_BUCKET_PUBLIC_URL/);
        return true;
    });
    strict_1.default.equal(calls.signedTargets.length, 0);
});
(0, node_test_1.test)('HTTP public domain configuration is served over HTTPS like the video worker', async () => {
    const bytes = await validAvatarPng();
    const publicWrites = [];
    const adapter = {
        createSignedUploadUrl: async () => 'https://upload.example/presigned',
        getObjectMetadata: async () => ({ contentLength: bytes.length, contentType: 'image/png' }),
        getObjectBytes: async () => bytes,
        putPublicObject: async (input) => { publicWrites.push(input); },
    };
    const storage = (0, storage_service_1.createChannelImageStorageService)(adapter, {
        rawBucket: 'private-raw',
        publicBucket: 'existing-public',
        publicDomain: 'http://media.example',
    });
    const publicUrl = await storage.publishUploadedImage({ ...confirmation, fileSize: bytes.length });
    strict_1.default.match(publicUrl ?? '', /^https:\/\/media\.example\/channel-images\//);
    strict_1.default.equal(publicWrites.length, 1);
});
