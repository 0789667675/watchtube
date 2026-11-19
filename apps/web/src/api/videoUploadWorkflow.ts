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
export const ALLOWED_VIDEO_UPLOAD_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

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

export function sanitizeUploadProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export type UploadFailureStage = 'intent' | 'upload' | 'verification';

export class UploadWorkflowError extends Error {
  readonly stage: UploadFailureStage;
  readonly videoId: string | undefined;
  readonly originalError: unknown;

  constructor(
    stage: UploadFailureStage,
    videoId: string | undefined,
    originalError: unknown,
  ) {
    super('Video upload workflow failed');
    this.name = 'UploadWorkflowError';
    this.stage = stage;
    this.videoId = videoId;
    this.originalError = originalError;
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
    throw new UploadWorkflowError('upload', intent.videoId, error);
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
    throw new UploadWorkflowError('upload', videoId, error);
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
