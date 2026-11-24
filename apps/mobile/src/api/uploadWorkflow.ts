import type { VideoCategory, VideoStatus, VideoVisibility } from './contracts';

function defaultTransferStatusError(status: number): string {
  if (status === 401 || status === 403) {
    return `Cloud storage rejected the binary upload (HTTP ${status}). Verify R2 credentials, PutObject permissions, and bucket CORS, then retry.`;
  }
  if (status === 429) {
    return 'Cloud storage is temporarily throttling uploads (HTTP 429). Wait briefly, then retry.';
  }
  if (status >= 500) {
    return `Cloud storage returned a server error (HTTP ${status}). Retry in a moment.`;
  }
  return `Binary upload failed with storage status HTTP ${status}.`;
}

function extractErrorMessage(error: unknown, fallback: string, isTransfer = false): string {
  if (typeof error === 'object' && error !== null) {
    const response = 'response' in error ? error.response : undefined;
    if (typeof response === 'object' && response !== null) {
      const data = 'data' in response ? response.data : undefined;
      if (typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string') {
        return data.error;
      }
      const respStatus = 'status' in response && typeof response.status === 'number'
        ? response.status
        : undefined;
      if (respStatus !== undefined) {
        if (isTransfer && respStatus >= 400) return defaultTransferStatusError(respStatus);
        if (respStatus === 401) return 'Sign in to continue.';
        if (respStatus === 403) return 'Your account is not permitted to perform this action.';
        if (respStatus === 404) return 'This content is no longer available.';
        if (respStatus === 429) return 'Too many requests. Wait a moment and try again.';
        if (respStatus >= 500) return 'WatchTube is temporarily unavailable. Please try again.';
      }
    }
    if (isTransfer && 'status' in error && typeof error.status === 'number' && error.status >= 400) {
      return defaultTransferStatusError(error.status);
    }
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    if (code && ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)) {
      return isTransfer
        ? 'The cloud storage upload endpoint could not be reached. Check network connectivity and R2 CORS settings, then retry.'
        : 'The WatchTube API could not be reached. Check the network and API address, then retry.';
    }
  }
  return error instanceof Error ? error.message : fallback;
}

export const MAX_VIDEO_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
export const MAX_SHORT_UPLOAD_SIZE = 1024 * 1024 * 1024;
export const MAX_SHORT_DURATION_SECONDS = 180;
export const MIN_SHORT_ASPECT_RATIO = 0.50625;
export const MAX_SHORT_ASPECT_RATIO = 0.61875;
export const MAX_VIDEO_TAGS = 20;
export const MAX_TAG_LENGTH = 50;
export const ALLOWED_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export type AllowedVideoContentType = typeof ALLOWED_VIDEO_CONTENT_TYPES[number];

export interface SelectedVideoAsset {
  uri: string;
  name: string;
  size: number;
  contentType: string;
  duration?: number;
  width?: number;
  height?: number;
  webFile?: Blob;
}

export interface VideoMetadataFormInput {
  channelId: string;
  isShort: boolean;
  title: string;
  description: string | null;
  tags: string[];
  category: VideoCategory;
  language: string;
  madeForKids: boolean;
  visibility: VideoVisibility;
  copyrightDeclared: boolean;
}

export type UploadWorkflowStage =
  | 'draft'
  | 'intent'
  | 'transfer'
  | 'verification'
  | 'publish';

export class UploadStageError extends Error {
  readonly stage: UploadWorkflowStage;
  readonly videoId?: string;
  readonly originalError: unknown;
  readonly canceled: boolean;

  constructor(
    stage: UploadWorkflowStage,
    message: string,
    originalError: unknown,
    videoId?: string,
    canceled = false,
  ) {
    super(message);
    this.name = 'UploadStageError';
    this.stage = stage;
    this.videoId = videoId;
    this.originalError = originalError;
    this.canceled = canceled;
  }
}

export function inferVideoContentType(fileName?: string | null, mimeType?: string | null): string {
  const normalizedMime = mimeType?.trim().toLowerCase().split(';')[0] ?? '';
  if ((ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(normalizedMime)) {
    return normalizedMime;
  }
  const lowerName = (fileName ?? '').trim().toLowerCase();
  if (lowerName.endsWith('.mp4') || lowerName.endsWith('.m4v')) return 'video/mp4';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  if (lowerName.endsWith('.mov') || lowerName.endsWith('.qt')) return 'video/quicktime';
  return normalizedMime;
}

export function parseTagsInput(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[,\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
}

export function validateMetadataInput(input: VideoMetadataFormInput): string | null {
  const title = input.title.trim();
  if (!title) return 'Video title is required.';
  if (title.length > 255) return 'Video title must be 255 characters or fewer.';
  if (input.description && input.description.trim().length > 5000) {
    return 'Description must be 5000 characters or fewer.';
  }
  if (input.tags.length > MAX_VIDEO_TAGS) {
    return `Use up to ${MAX_VIDEO_TAGS} tags.`;
  }
  if (input.tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    return `Each tag must be ${MAX_TAG_LENGTH} characters or fewer.`;
  }
  const language = input.language.trim();
  if (language.length < 2 || language.length > 35) {
    return 'Language must be between 2 and 35 characters.';
  }
  if (!input.copyrightDeclared) {
    return 'You must declare copyright ownership or rights before uploading.';
  }
  return null;
}

export function validateSelectedVideoFile(
  file: Pick<SelectedVideoAsset, 'name' | 'size' | 'contentType'>,
  isShort: boolean,
): string | null {
  const resolvedType = inferVideoContentType(file.name, file.contentType);
  if (!(ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(resolvedType)) {
    return 'Select an MP4, WebM, or QuickTime (.mov) video file.';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return 'The selected video file is empty or unreadable.';
  }
  const maxSize = isShort ? MAX_SHORT_UPLOAD_SIZE : MAX_VIDEO_UPLOAD_SIZE;
  if (file.size > maxSize) {
    return isShort
      ? 'Shorts must be 1 GB or smaller.'
      : 'Videos must be 2 GB or smaller.';
  }
  return null;
}

export function validateShortVideoDimensions(
  duration?: number,
  width?: number,
  height?: number,
): string | null {
  if (duration == null || !Number.isFinite(duration) || duration <= 0 || duration > MAX_SHORT_DURATION_SECONDS) {
    return 'Shorts must be 3 minutes (180 seconds) or shorter.';
  }
  if (
    width == null
    || height == null
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return 'Short video dimensions could not be read from this file.';
  }
  const aspectRatio = width / height;
  if (aspectRatio < MIN_SHORT_ASPECT_RATIO || aspectRatio > MAX_SHORT_ASPECT_RATIO) {
    return 'Choose a portrait video close to a 9:16 aspect ratio.';
  }
  return null;
}

export interface UploadWorkflowClient {
  createDraft(metadata: VideoMetadataFormInput): Promise<{ videoId: string; status: string }>;
  updateMetadata(videoId: string, metadata: Omit<VideoMetadataFormInput, 'channelId'>): Promise<void>;
  requestUploadIntent(input: {
    videoId: string;
    contentType: string;
    fileSize: number;
    duration?: number;
    width?: number;
    height?: number;
  }): Promise<{ videoId: string; uploadUrl: string; expiresIn: number; status: string }>;
  refreshUploadUrl(input: {
    videoId: string;
    contentType: string;
    fileSize: number;
  }): Promise<{ uploadUrl: string; expiresIn: number }>;
  transferBinary(
    uploadUrl: string,
    file: SelectedVideoAsset,
    onProgress: (percent: number) => void,
  ): Promise<void>;
  verifyUpload(videoId: string): Promise<{ videoId: string; status: string }>;
}

export function sanitizeUploadProgress(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function isAbortLikeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? error.name : undefined;
  const code = 'code' in error ? error.code : undefined;
  return name === 'AbortError' || code === 'ERR_CANCELED';
}

export interface UploadPipelineCallbacks {
  onStage?: (stage: UploadWorkflowStage) => void;
  onDraftCreated?: (videoId: string, status: string) => void;
  onIntentGranted?: (videoId: string, uploadUrl: string, status: string) => void;
  onProgress?: (percent: number) => void;
}

export async function runCreatorUploadPipeline(
  client: UploadWorkflowClient,
  input: {
    existingVideoId?: string | null;
    existingStatus?: VideoStatus | null;
    metadata: VideoMetadataFormInput;
    file: SelectedVideoAsset;
  },
  callbacks: UploadPipelineCallbacks = {},
): Promise<{ videoId: string; status: string }> {
  const metadataError = validateMetadataInput(input.metadata);
  if (metadataError) throw new Error(metadataError);

  const fileError = validateSelectedVideoFile(input.file, input.metadata.isShort);
  if (fileError) throw new Error(fileError);

  if (input.metadata.isShort) {
    const dimsError = validateShortVideoDimensions(
      input.file.duration,
      input.file.width,
      input.file.height,
    );
    if (dimsError) throw new Error(dimsError);
  }

  let videoId = input.existingVideoId ?? undefined;
  const currentStatus = input.existingStatus ?? 'DRAFT';

  callbacks.onStage?.('draft');
  try {
    if (videoId) {
      const { channelId: _channelId, ...patchBody } = input.metadata;
      await client.updateMetadata(videoId, patchBody);
    } else {
      const draft = await client.createDraft(input.metadata);
      videoId = draft.videoId;
      callbacks.onDraftCreated?.(videoId, draft.status);
    }
  } catch (error) {
    throw new UploadStageError(
      'draft',
      extractErrorMessage(error, 'Failed to save video draft.'),
      error,
      videoId,
    );
  }

  callbacks.onStage?.('intent');
  let uploadUrl: string;
  try {
    if (currentStatus === 'UPLOADING') {
      const refreshed = await client.refreshUploadUrl({
        videoId,
        contentType: input.file.contentType,
        fileSize: input.file.size,
      });
      uploadUrl = refreshed.uploadUrl;
      callbacks.onIntentGranted?.(videoId, uploadUrl, 'UPLOADING');
    } else {
      const intent = await client.requestUploadIntent({
        videoId,
        contentType: input.file.contentType,
        fileSize: input.file.size,
        ...(input.metadata.isShort
          ? {
            duration: input.file.duration,
            width: Math.round(input.file.width!),
            height: Math.round(input.file.height!),
          }
          : {}),
      });
      uploadUrl = intent.uploadUrl;
      callbacks.onIntentGranted?.(videoId, uploadUrl, intent.status);
    }
  } catch (error) {
    throw new UploadStageError(
      'intent',
      extractErrorMessage(error, 'Failed to prepare upload target.'),
      error,
      videoId,
    );
  }

  callbacks.onStage?.('transfer');
  try {
    await client.transferBinary(uploadUrl, input.file, (percent) => {
      callbacks.onProgress?.(sanitizeUploadProgress(percent));
    });
    callbacks.onProgress?.(100);
  } catch (error) {
    const canceled = isAbortLikeError(error);
    const message = canceled
      ? 'Binary upload was canceled before completion. Retry to upload the file.'
      : extractErrorMessage(error, 'Binary upload to storage failed.', true);
    throw new UploadStageError('transfer', message, error, videoId, canceled);
  }

  callbacks.onStage?.('verification');
  try {
    return await client.verifyUpload(videoId);
  } catch (error) {
    throw new UploadStageError(
      'verification',
      extractErrorMessage(error, 'Upload verification could not complete.'),
      error,
      videoId,
    );
  }
}

export async function retryBinaryTransferAndVerify(
  client: Pick<UploadWorkflowClient, 'refreshUploadUrl' | 'transferBinary' | 'verifyUpload'>,
  videoId: string,
  file: SelectedVideoAsset,
  callbacks: Pick<UploadPipelineCallbacks, 'onStage' | 'onIntentGranted' | 'onProgress'> = {},
): Promise<{ videoId: string; status: string }> {
  callbacks.onStage?.('intent');
  let uploadUrl: string;
  try {
    const refreshed = await client.refreshUploadUrl({
      videoId,
      contentType: file.contentType,
      fileSize: file.size,
    });
    uploadUrl = refreshed.uploadUrl;
    callbacks.onIntentGranted?.(videoId, uploadUrl, 'UPLOADING');
  } catch (error) {
    throw new UploadStageError(
      'intent',
      extractErrorMessage(error, 'Could not refresh upload URL.'),
      error,
      videoId,
    );
  }

  callbacks.onStage?.('transfer');
  try {
    await client.transferBinary(uploadUrl, file, (percent) => {
      callbacks.onProgress?.(sanitizeUploadProgress(percent));
    });
    callbacks.onProgress?.(100);
  } catch (error) {
    const canceled = isAbortLikeError(error);
    const message = canceled
      ? 'Binary upload was canceled before completion. Retry to upload the file.'
      : extractErrorMessage(error, 'Binary upload to storage failed.', true);
    throw new UploadStageError('transfer', message, error, videoId, canceled);
  }

  callbacks.onStage?.('verification');
  try {
    return await client.verifyUpload(videoId);
  } catch (error) {
    throw new UploadStageError(
      'verification',
      extractErrorMessage(error, 'Upload verification could not complete.'),
      error,
      videoId,
    );
  }
}

export function isTerminalProcessingStatus(status: VideoStatus): boolean {
  return ['READY_FOR_REVIEW', 'PUBLISHED', 'READY', 'FAILED', 'BLOCKED', 'REJECTED'].includes(status);
}
