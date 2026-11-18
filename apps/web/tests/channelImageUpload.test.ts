import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChannelImageUploadError,
  uploadChannelImage,
} from '../src/api/channelImageUpload.js';
import type { ChannelImageUploadDependencies } from '../src/api/channelImageUpload.js';
import type { StudioChannelSettings } from '../src/pages/studio/studioApi.js';

const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const IMAGE_URL = 'https://media.example/channel-images/avatar.webp';
const channel: StudioChannelSettings = {
  id: CHANNEL_ID,
  name: 'Test channel',
  handle: '@test',
  description: null,
  avatarUrl: IMAGE_URL,
  bannerUrl: null,
};

function createFile(): File {
  return new File([Buffer.from('test-image-bytes')], 'avatar.png', { type: 'image/png' });
}

function createDependencies(calls: string[]): ChannelImageUploadDependencies {
  return {
    requestIntent: async (metadata) => {
      calls.push(`intent:${metadata.channelId}:${metadata.purpose}`);
      return {
        uploadUrl: 'https://upload.example/presigned',
        uploadToken: 'signed-upload-ticket',
        expiresIn: 900,
      };
    },
    upload: async (url, file, onProgress) => {
      calls.push(`upload:${url}:${file.name}`);
      onProgress(50);
    },
    confirm: async (channelId, purpose, token) => {
      calls.push(`confirm:${channelId}:${purpose}:${token}`);
      return { channel, imageUrl: IMAGE_URL };
    },
  };
}

test('channel image workflow uploads before it confirms and returns only the server result', async () => {
  const calls: string[] = [];
  const progress: number[] = [];
  const result = await uploadChannelImage(
    createDependencies(calls),
    {
      channelId: CHANNEL_ID,
      purpose: 'avatar',
      contentType: 'image/png',
      fileSize: createFile().size,
    },
    createFile(),
    (value) => progress.push(value),
  );

  assert.deepEqual(calls, [
    `intent:${CHANNEL_ID}:avatar`,
    'upload:https://upload.example/presigned:avatar.png',
    `confirm:${CHANNEL_ID}:avatar:signed-upload-ticket`,
  ]);
  assert.deepEqual(progress, [50, 100]);
  assert.equal(result.channel.avatarUrl, IMAGE_URL);
});

test('upload failures do not confirm, and confirmation failures retain the ticket for retry', async () => {
  const uploadFailureCalls: string[] = [];
  const uploadFailureDependencies = createDependencies(uploadFailureCalls);
  uploadFailureDependencies.upload = async () => {
    throw new Error('transfer failed');
  };
  await assert.rejects(
    uploadChannelImage(
      uploadFailureDependencies,
      { channelId: CHANNEL_ID, purpose: 'avatar', contentType: 'image/png', fileSize: 10 },
      createFile(),
      () => undefined,
    ),
    (error: unknown) => error instanceof ChannelImageUploadError && error.stage === 'upload',
  );
  assert.equal(uploadFailureCalls.some((call) => call.startsWith('confirm:')), false);

  const confirmationFailureDependencies = createDependencies([]);
  confirmationFailureDependencies.confirm = async () => {
    throw new Error('confirmation unavailable');
  };
  await assert.rejects(
    uploadChannelImage(
      confirmationFailureDependencies,
      { channelId: CHANNEL_ID, purpose: 'avatar', contentType: 'image/png', fileSize: 10 },
      createFile(),
      () => undefined,
    ),
    (error: unknown) => (
      error instanceof ChannelImageUploadError
      && error.stage === 'confirmation'
      && error.intent?.uploadToken === 'signed-upload-ticket'
    ),
  );
});
