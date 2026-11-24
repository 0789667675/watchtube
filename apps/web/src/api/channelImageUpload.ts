import axios from 'axios';
import {
  isStudioChannelImageConfirmation,
  isStudioChannelImageUploadIntent,
} from '../pages/studio/studioApi.js';
import type {
  StudioChannelImagePurpose,
  StudioChannelImageConfirmation,
  StudioChannelImageUploadIntent,
} from '../pages/studio/studioApi.js';

export type ChannelImageUploadStage = 'intent' | 'upload' | 'confirmation';

export interface ChannelImageUploadMetadata {
  channelId: string;
  purpose: StudioChannelImagePurpose;
  contentType: string;
  fileSize: number;
}

export interface ChannelImageUploadDependencies {
  requestIntent(metadata: ChannelImageUploadMetadata): Promise<unknown>;
  upload(
    uploadUrl: string,
    file: File,
    onProgress: (progress: number) => void,
  ): Promise<void>;
  confirm(
    channelId: string,
    purpose: StudioChannelImagePurpose,
    uploadToken: string,
  ): Promise<unknown>;
}

export class ChannelImageUploadError extends Error {
  readonly stage: ChannelImageUploadStage;
  readonly originalError: unknown;
  readonly intent: StudioChannelImageUploadIntent | undefined;

  constructor(
    stage: ChannelImageUploadStage,
    originalError: unknown,
    intent?: StudioChannelImageUploadIntent,
  ) {
    super('Channel image upload workflow failed.');
    this.name = 'ChannelImageUploadError';
    this.stage = stage;
    this.originalError = originalError;
    this.intent = intent;
  }
}

export function getChannelImageUploadErrorMessage(
  error: ChannelImageUploadError,
  fallback: string,
): string {
  if (
    error.stage === 'upload'
    && axios.isAxiosError(error.originalError)
    && !error.originalError.response
  ) {
    return 'The image could not be transferred to storage. Check your connection or storage configuration, then retry.';
  }

  if (
    axios.isAxiosError<{ error?: unknown }>(error.originalError)
    && typeof error.originalError.response?.data?.error === 'string'
  ) {
    return error.originalError.response.data.error;
  }

  return fallback;
}

export async function uploadChannelImage(
  dependencies: ChannelImageUploadDependencies,
  metadata: ChannelImageUploadMetadata,
  file: File,
  onProgress: (progress: number) => void,
): Promise<StudioChannelImageConfirmation> {
  let intent: StudioChannelImageUploadIntent;
  try {
    const response = await dependencies.requestIntent(metadata);
    if (!isStudioChannelImageUploadIntent(response)) {
      throw new Error('The server did not return a valid image upload target.');
    }
    intent = response;
  } catch (error) {
    throw new ChannelImageUploadError('intent', error);
  }

  try {
    await dependencies.upload(intent.uploadUrl, file, onProgress);
  } catch (error) {
    throw new ChannelImageUploadError('upload', error, intent);
  }

  try {
    const response = await dependencies.confirm(
      metadata.channelId,
      metadata.purpose,
      intent.uploadToken,
    );
    if (!isStudioChannelImageConfirmation(response, metadata.purpose)) {
      throw new Error('The server did not confirm the saved channel image.');
    }
    onProgress(100);
    return response;
  } catch (error) {
    throw new ChannelImageUploadError('confirmation', error, intent);
  }
}
