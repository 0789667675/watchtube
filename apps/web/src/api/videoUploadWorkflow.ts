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
  let intent: UploadIntent;
  try {
    intent = await dependencies.requestIntent(metadata);
  } catch (error) {
    throw new UploadWorkflowError('intent', undefined, error);
  }

  onVideoCreated(intent.videoId);
  try {
    await dependencies.upload(intent.uploadUrl, file, onProgress);
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
  let uploadUrl: string;
  try {
    uploadUrl = await dependencies.refreshUploadUrl(videoId, metadata);
  } catch (error) {
    throw new UploadWorkflowError('upload', videoId, error);
  }

  try {
    await dependencies.upload(uploadUrl, file, onProgress);
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
