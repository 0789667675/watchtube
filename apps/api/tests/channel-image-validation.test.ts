import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  InvalidChannelImageError,
  processChannelImage,
  processVideoThumbnail,
} from '../src/services/channel-image.service';

async function createPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 12, g: 100, b: 220 },
    },
  }).png().toBuffer();
}

test('avatar images are decoded, normalized to WebP, and resized to 512 square', async () => {
  const output = await processChannelImage(await createPng(800, 600), 'avatar', 'image/png');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});

test('banner images are decoded, normalized to WebP, and resized to 1920 by 640', async () => {
  const output = await processChannelImage(await createPng(1500, 500), 'banner', 'image/png');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 640);
});

test('banner dimensions account for EXIF orientation', async () => {
  const orientedJpeg = await sharp({
    create: {
      width: 400,
      height: 1600,
      channels: 3,
      background: { r: 12, g: 100, b: 220 },
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const output = await processChannelImage(orientedJpeg, 'banner', 'image/jpeg');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 640);
});

test('image processing rejects unsupported, mislabeled, malformed, and undersized content', async () => {
  const validPng = await createPng(128, 128);

  await assert.rejects(
    processChannelImage(validPng, 'avatar', 'image/svg+xml'),
    InvalidChannelImageError,
  );
  await assert.rejects(
    processChannelImage(validPng, 'avatar', 'image/jpeg'),
    InvalidChannelImageError,
  );
  await assert.rejects(
    processChannelImage(Buffer.from('not an image'), 'avatar', 'image/png'),
    InvalidChannelImageError,
  );
  await assert.rejects(
    processChannelImage(await createPng(48, 48), 'avatar', 'image/png'),
    InvalidChannelImageError,
  );
  await assert.rejects(
    processChannelImage(await createPng(800, 400), 'banner', 'image/png'),
    InvalidChannelImageError,
  );
});

test('video thumbnails validate their image bytes and normalize to a 1280 by 720 WebP', async () => {
  const output = await processVideoThumbnail(await createPng(640, 480), 'image/png');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 720);

  await assert.rejects(processVideoThumbnail(Buffer.from('not an image'), 'image/png'), InvalidChannelImageError);
  await assert.rejects(processVideoThumbnail(await createPng(100, 100), 'image/png'), InvalidChannelImageError);
  await assert.rejects(processVideoThumbnail(await createPng(640, 480), 'image/jpeg'), InvalidChannelImageError);
});

test('Short thumbnails require portrait dimensions and normalize to a 720 by 1280 WebP', async () => {
  const output = await processVideoThumbnail(await createPng(360, 640), 'image/png', true);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 720);
  assert.equal(metadata.height, 1280);

  const orientedJpeg = await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 3,
      background: { r: 12, g: 100, b: 220 },
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const orientedOutput = await processVideoThumbnail(orientedJpeg, 'image/jpeg', true);
  const orientedMetadata = await sharp(orientedOutput).metadata();
  assert.equal(orientedMetadata.width, 720);
  assert.equal(orientedMetadata.height, 1280);

  await assert.rejects(
    processVideoThumbnail(await createPng(640, 480), 'image/png', true),
    InvalidChannelImageError,
  );
  await assert.rejects(
    processVideoThumbnail(await createPng(100, 300), 'image/png', true),
    InvalidChannelImageError,
  );
});
