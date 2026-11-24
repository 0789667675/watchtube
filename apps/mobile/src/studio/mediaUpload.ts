import { File, UploadType } from 'expo-file-system';
import { createVideoPlayer } from 'expo-video';
import { getUploadTransferStatusError } from '@/api/client';
import { inferVideoContentType, type SelectedVideoAsset } from '@/api/uploadWorkflow';

export class StorageTransferError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'StorageTransferError';
    this.status = status;
  }
}

async function inspectVideoMetadataNative(
  uri: string,
): Promise<{ duration?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    let settled = false;
    let player: ReturnType<typeof createVideoPlayer> | null = null;
    const subscriptions: { remove: () => void }[] = [];

    const finish = (meta: { duration?: number; width?: number; height?: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      for (const sub of subscriptions) sub.remove();
      try {
        player?.release();
      } catch {
        // Ignore cleanup errors on already-released native player
      }
      resolve(meta);
    };

    const timeout = setTimeout(() => finish({}), 8000);

    try {
      player = createVideoPlayer(uri);
      subscriptions.push(
        player.addListener('sourceLoad', (payload) => {
          const trackSize = payload.availableVideoTracks[0]?.size;
          finish({
            duration: Number.isFinite(payload.duration) && payload.duration > 0 ? payload.duration : undefined,
            width: trackSize?.width && trackSize.width > 0 ? trackSize.width : undefined,
            height: trackSize?.height && trackSize.height > 0 ? trackSize.height : undefined,
          });
        }),
      );
      subscriptions.push(
        player.addListener('statusChange', (event) => {
          if (event.status === 'error') {
            finish({});
          } else if (event.status === 'readyToPlay' && player) {
            const trackSize = player.availableVideoTracks[0]?.size;
            if (player.duration > 0 || trackSize) {
              finish({
                duration: Number.isFinite(player.duration) && player.duration > 0 ? player.duration : undefined,
                width: trackSize?.width && trackSize.width > 0 ? trackSize.width : undefined,
                height: trackSize?.height && trackSize.height > 0 ? trackSize.height : undefined,
              });
            }
          }
        }),
      );
    } catch {
      finish({});
    }
  });
}

export async function pickVideoForUpload(): Promise<SelectedVideoAsset | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  });
  if (picked.canceled || !picked.result) {
    return null;
  }

  const file = picked.result;
  let size = file.size;
  if (!size) {
    try {
      size = file.info().size ?? 0;
    } catch {
      size = 0;
    }
  }

  const contentType = inferVideoContentType(file.name, file.type);
  const metadata = await inspectVideoMetadataNative(file.uri);

  return {
    uri: file.uri,
    name: file.name || 'video.mp4',
    size,
    contentType,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
  };
}

export async function transferVideoBinary(
  uploadUrl: string,
  asset: SelectedVideoAsset,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const fsFile = new File(asset.uri);
  const task = fsFile.createUploadTask(uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: asset.contentType,
    headers: { 'Content-Type': asset.contentType },
    sessionType: 'foreground',
    signal,
    onProgress: ({ bytesSent, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : asset.size;
      if (total > 0) {
        onProgress((bytesSent / total) * 100);
      }
    },
  });

  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new StorageTransferError(result.status, getUploadTransferStatusError(result.status));
  }
}
