import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const uploadModalUrl = new URL('../src/components/studio/UploadModal.tsx', import.meta.url);
const contentPageUrl = new URL('../src/pages/studio/ContentPage.tsx', import.meta.url);
const monetizationPageUrl = new URL('../src/pages/studio/MonetizationPage.tsx', import.meta.url);
const dashboardPageUrl = new URL('../src/pages/studio/DashboardPage.tsx', import.meta.url);
const videoUploadWorkflowUrl = new URL('../src/api/videoUploadWorkflow.ts', import.meta.url);

test('UploadModal implements complete draft creation, metadata editing, and publishing contracts', async () => {
  const source = await readFile(uploadModalUrl, 'utf8');

  // Draft loading with AbortController and correct phase mapping
  assert.match(source, /\/api\/v1\/videos\/\$\{initialVideoId\}/);
  assert.match(source, /signal:\s*controller\.signal/);
  assert.match(source, /data\.status === 'PROCESSING'/);
  assert.match(source, /data\.status === 'READY_FOR_REVIEW' \|\| data\.status === 'READY'/);
  assert.match(source, /'ready-to-publish'/);
  assert.match(source, /data\.status === 'PUBLISHED'/);

  // Draft saving and metadata updates
  assert.match(source, /\/api\/v1\/videos\/drafts/);
  assert.match(source, /apiClient\.patch\(`\/api\/v1\/videos\/\$\{id\}`/);
  assert.match(source, /channelId,\s*\.\.\.metadata/);

  // Video upload intent and refresh
  assert.match(source, /\/api\/v1\/videos\/upload-intent/);
  assert.match(source, /\/api\/v1\/videos\/\$\{id\}\/upload-url/);
  assert.match(source, /\/api\/v1\/videos\/\$\{id\}\/verify-upload/);

  // Upload status polling
  assert.match(source, /\/api\/v1\/videos\/\$\{id\}\/upload-status/);
  assert.match(source, /READY_FOR_REVIEW.*READY/);

  // Publishing contract requiring copyright declaration
  assert.match(source, /\/api\/v1\/videos\/\$\{videoId\}\/publish/);
  assert.match(source, /Declare that you own or have permission to upload this content before publishing/);
  assert.match(source, /canPublish/);

  // Thumbnail upload with direct storage error isolation and decoupled lifecycle
  assert.match(source, /\/api\/v1\/videos\/\$\{id\}\/thumbnail-upload-intent/);
  assert.match(source, /\/api\/v1\/videos\/\$\{id\}\/thumbnail-confirmation/);
  assert.match(source, /getUploadTransferErrorMessage/);
  assert.match(source, /validateThumbnailFile/);
  assert.match(source, /validateThumbnailDimensions/);
  assert.match(source, /readImageDimensions/);
  assert.match(source, /setThumbnailError/);
  assert.match(source, /performThumbnailUpload/);
  const saveMetadataBody = source.match(/const saveMetadata = useCallback\([\s\S]*?return id;\s*\},/)?.[0] ?? '';
  assert.ok(saveMetadataBody.length > 0);
  assert.doesNotMatch(saveMetadataBody, /uploadThumbnail/);

  // Video preview and custom thumbnail preview
  assert.match(source, /<video\s+src=\{videoPreviewUrl/);
  assert.match(source, /thumbnailPreviewUrl\s*\|\|\s*thumbnailUrl/);

  // Form restrictions and counters
  assert.match(source, /titleValue\.length\}\/255/);
  assert.match(source, /descValue\.length\}\/5000/);
  assert.match(source, /tags:\s*tagValue/);
  assert.match(source, /Publish as a Short/);
  assert.match(source, /isShortValue/);
  assert.match(source, /portrait 9:16/i);
});

test('UploadModal enforces accessible markup and responsive dialog layout', async () => {
  const source = await readFile(uploadModalUrl, 'utf8');

  // Accessible dialog attributes
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby="upload-dialog-title"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status"/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /progress aria-label="Video upload progress"/);

  // Responsive modal layout without clipped overflow
  assert.match(source, /max-h-\[95vh\]/);
  assert.match(source, /overflow-y-auto/);
});

test('ContentPage integrates upload editor, draft editing, and auto-refresh on change', async () => {
  const source = await readFile(contentPageUrl, 'utf8');

  // Video list fetch and refresh
  assert.match(source, /\/api\/v1\/videos\/mine/);
  assert.match(source, /onUploaded=\{refreshVideos\}/);

  // Upload modal triggers
  assert.match(source, /setVideoToEdit\(null\);\s*setUploadIsShort\(false\);\s*setIsUploadOpen\(true\)/);
  assert.match(source, /setVideoToEdit\(null\);\s*setUploadIsShort\(true\);\s*setIsUploadOpen\(true\)/);
  assert.match(source, /setVideoToEdit\(video\.id\)/);
  assert.match(source, /setUploadIsShort\(Boolean\(video\.isShort\)\)/);

  // Status badges distinguishing Shorts and processing states
  assert.match(source, /video\.isShort \? 'SHORT · ' : ''/);
});

test('Financial Privacy is strictly preserved across all Creator Studio pages', async () => {
  const monetizationSource = await readFile(monetizationPageUrl, 'utf8');
  const dashboardSource = await readFile(dashboardPageUrl, 'utf8');

  // No internal revenue split (e.g. 50/50), provider fee/tax discussions, or unverified earnings
  assert.doesNotMatch(monetizationSource, /50\/50/i);
  assert.doesNotMatch(monetizationSource, /50%\s*WatchTube/i);
  assert.doesNotMatch(monetizationSource, /provider fee/i);
  assert.doesNotMatch(monetizationSource, /tax treatment/i);
  assert.doesNotMatch(monetizationSource, /invalid-traffic/i);

  // Dashboard has no speculative unverified earnings card
  assert.doesNotMatch(dashboardSource, /Earnings and payouts/i);
  assert.doesNotMatch(dashboardSource, /No verified ad allocations/i);
});

test('videoUploadWorkflow enforces asset limits for standard videos, Shorts, and thumbnails', async () => {
  const source = await readFile(videoUploadWorkflowUrl, 'utf8');

  assert.match(source, /MAX_VIDEO_UPLOAD_SIZE = 2 \* 1024 \* 1024 \* 1024/);
  assert.match(source, /MAX_SHORT_UPLOAD_SIZE = 1024 \* 1024 \* 1024/);
  assert.match(source, /MAX_SHORT_DURATION_SECONDS = 180/);
  assert.match(source, /MAX_THUMBNAIL_UPLOAD_SIZE = 5 \* 1024 \* 1024/);
  assert.match(source, /MIN_THUMBNAIL_WIDTH = 320/);
  assert.match(source, /MIN_THUMBNAIL_HEIGHT = 180/);
  assert.match(source, /MIN_SHORT_THUMBNAIL_WIDTH = 180/);
  assert.match(source, /MIN_SHORT_THUMBNAIL_HEIGHT = 320/);
});
