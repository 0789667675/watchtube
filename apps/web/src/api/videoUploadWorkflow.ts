export interface UploadFile {
  name: string;
  size: number;
  type: string;
}

export interface UploadMetadata {
  title: string;
  contentType: string;
  fileSize: number;
  channelId: string;
  isShort?: boolean;
  duration?: number;
  width?: number;
  height?: number;
}

export interface UploadIntent {
  videoId: string;
  uploadUrl: string;
}

export interface UploadWorkflowDependencies {
  requestIntent(metadata: UploadMetadata): Promise<UploadIntent>;
  refreshUploadUrl(videoId: string, metadata: Pick<UploadMetadata, 'contentType' | 'fileSize'>): Promise<string>;
  upload(url: string, file: UploadFile, onProgress: (progress: number) => void): Promise<void>;
  verify(videoId: string): Promise<void>;
}

export const MAX_VIDEO_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
export const MAX_SHORT_UPLOAD_SIZE = 1024 * 1024 * 1024;
export const MAX_SHORT_DURATION_SECONDS = 180;
export const ALLOWED_VIDEO_UPLOAD_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export const MAX_THUMBNAIL_UPLOAD_SIZE = 5 * 1024 * 1024;
export const ALLOWED_THUMBNAIL_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MIN_THUMBNAIL_WIDTH = 320;
export const MIN_THUMBNAIL_HEIGHT = 180;
export const MIN_SHORT_THUMBNAIL_WIDTH = 180;
export const MIN_SHORT_THUMBNAIL_HEIGHT = 320;

export function normalizeUploadTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

export function validateUploadTitle(title: string): string | null {
  const normalized = normalizeUploadTitle(title);
  if (!normalized) return 'Enter a video title.';
  if (normalized.length > 255) return 'Video titles must be 255 characters or fewer.';
  return null;
}

export function validateUploadFile(file: UploadFile): string | null {
  if (!ALLOWED_VIDEO_UPLOAD_TYPES.includes(file.type as typeof ALLOWED_VIDEO_UPLOAD_TYPES[number])) {
    return 'Choose an MP4, WebM, or QuickTime video.';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return 'The selected file is empty.';
  }
  if (file.size > MAX_VIDEO_UPLOAD_SIZE) {
    return 'Choose a video no larger than 2 GB.';
  }
  return null;
}

export function validateThumbnailFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_THUMBNAIL_UPLOAD_TYPES.includes(file.type as typeof ALLOWED_THUMBNAIL_UPLOAD_TYPES[number])) {
    return 'Choose a JPEG, PNG, or WebP thumbnail.';
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return 'The selected thumbnail file is empty.';
  }
  if (file.size > MAX_THUMBNAIL_UPLOAD_SIZE) {
    return 'Choose a thumbnail no larger than 5 MB.';
  }
  return null;
}

export function validateThumbnailDimensions(
  width: number,
  height: number,
  isShort = false,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'Thumbnail dimensions could not be determined.';
  }
  if (isShort) {
    if (width < MIN_SHORT_THUMBNAIL_WIDTH || height < MIN_SHORT_THUMBNAIL_HEIGHT) {
      return `Short thumbnails must be at least ${MIN_SHORT_THUMBNAIL_WIDTH} × ${MIN_SHORT_THUMBNAIL_HEIGHT} portrait pixels.`;
    }
    const ratio = width / height;
    if (ratio < 0.50625 || ratio > 0.61875) {
      return 'Choose a portrait thumbnail close to the 9:16 aspect ratio.';
    }
  } else {
    if (width < MIN_THUMBNAIL_WIDTH || height < MIN_THUMBNAIL_HEIGHT) {
      return `Thumbnails must be at least ${MIN_THUMBNAIL_WIDTH} × ${MIN_THUMBNAIL_HEIGHT} pixels.`;
    }
  }
  return null;
}

export function validateShortUploadFile(
  file: UploadFile,
  duration: number,
  width: number,
  height: number,
): string | null {
  const fileError = validateUploadFile(file);
  if (fileError) return fileError;
  if (file.size > MAX_SHORT_UPLOAD_SIZE) {
    return 'Choose a Short no larger than 1 GB.';
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SHORT_DURATION_SECONDS) {
    return 'Shorts must be 3 minutes or shorter.';
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'Short video dimensions could not be determined.';
  }
  const aspectRatio = width / height;
  if (aspectRatio < 0.50625 || aspectRatio > 0.61875) {
    return 'Choose a portrait Short close to the 9:16 aspect ratio.';
  }
  return null;
}

export function sanitizeUploadProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export type UploadFailureStage = 'intent' | 'upload' | 'verification';

export function getUploadTransferErrorMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = 'code' in error ? error.code : undefined;
  const response = 'response' in error ? error.response : undefined;
  const status = typeof response === 'object' && response !== null && 'status' in response
    ? response.status
    : undefined;
  if (status === 401 || status === 403) {
    return 'Cloud storage rejected the upload. Check R2 credentials, bucket permissions, and CORS, then retry.';
  }
  if (status === 429) {
    return 'Cloud storage is temporarily throttling uploads. Wait briefly, then retry.';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'Cloud storage is temporarily unavailable. Retry in a moment.';
  }
  if (code === 'ERR_NETWORK') {
    return 'The cloud storage upload endpoint could not be reached. Check network connectivity and R2 CORS settings, then retry.';
  }
  return null;
}

export class UploadWorkflowError extends Error {
  readonly stage: UploadFailureStage;
  readonly videoId: string | undefined;
  readonly originalError: unknown;
  readonly isFileTransfer: boolean;

  constructor(
    stage: UploadFailureStage,
    videoId: string | undefined,
    originalError: unknown,
    isFileTransfer = false,
  ) {
    super('Video upload workflow failed');
    this.name = 'UploadWorkflowError';
    this.stage = stage;
    this.videoId = videoId;
    this.originalError = originalError;
    this.isFileTransfer = isFileTransfer;
  }
}

export async function startVideoUpload(
  dependencies: UploadWorkflowDependencies,
  metadata: UploadMetadata,
  file: UploadFile,
  onVideoCreated: (videoId: string) => void,
  onProgress: (progress: number) => void,
): Promise<string> {
  const safeProgress = (progress: number) => onProgress(sanitizeUploadProgress(progress));
  let intent: UploadIntent;
  try {
    intent = await dependencies.requestIntent(metadata);
  } catch (error) {
    throw new UploadWorkflowError('intent', undefined, error);
  }

  onVideoCreated(intent.videoId);
  try {
    await dependencies.upload(intent.uploadUrl, file, safeProgress);
  } catch (error) {
    throw new UploadWorkflowError('upload', intent.videoId, error, true);
  }

  try {
    await dependencies.verify(intent.videoId);
  } catch (error) {
    throw new UploadWorkflowError('verification', intent.videoId, error);
  }
  return intent.videoId;
}

export async function retryVideoUpload(
  dependencies: UploadWorkflowDependencies,
  videoId: string,
  metadata: Pick<UploadMetadata, 'contentType' | 'fileSize'>,
  file: UploadFile,
  onProgress: (progress: number) => void,
): Promise<void> {
  const safeProgress = (progress: number) => onProgress(sanitizeUploadProgress(progress));
  let uploadUrl: string;
  try {
    uploadUrl = await dependencies.refreshUploadUrl(videoId, metadata);
  } catch (error) {
    throw new UploadWorkflowError('upload', videoId, error);
  }

  try {
    await dependencies.upload(uploadUrl, file, safeProgress);
  } catch (error) {
    throw new UploadWorkflowError('upload', videoId, error, true);
  }

  try {
    await dependencies.verify(videoId);
  } catch (error) {
    throw new UploadWorkflowError('verification', videoId, error);
  }
}

export async function retryUploadVerification(
  dependencies: UploadWorkflowDependencies,
  videoId: string,
): Promise<void> {
  try {
    await dependencies.verify(videoId);
  } catch (error) {
    throw new UploadWorkflowError('verification', videoId, error);
  }
}
