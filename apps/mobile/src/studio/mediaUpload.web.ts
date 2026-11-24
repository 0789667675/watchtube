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

async function inspectVideoMetadataWeb(
  file: globalThis.File,
): Promise<{ duration?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      const meta = {
        duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined,
        width: video.videoWidth > 0 ? video.videoWidth : undefined,
        height: video.videoHeight > 0 ? video.videoHeight : undefined,
      };
      cleanup();
      resolve(meta);
    };

    video.onerror = () => {
      cleanup();
      resolve({});
    };

    video.src = url;
  });
}

export async function pickVideoForUpload(): Promise<SelectedVideoAsset | null> {
  if (typeof document === 'undefined') {
    throw new Error('File picker is unavailable outside a browser or native environment.');
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov';
    let settled = false;

    const handleCancel = () => {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 400);
    };

    input.onchange = async () => {
      settled = true;
      window.removeEventListener('focus', handleCancel);
      const selected = input.files?.[0];
      if (!selected) {
        resolve(null);
        return;
      }
      const metadata = await inspectVideoMetadataWeb(selected);
      resolve({
        uri: URL.createObjectURL(selected),
        name: selected.name,
        size: selected.size,
        contentType: inferVideoContentType(selected.name, selected.type),
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        webFile: selected,
      });
    };

    window.addEventListener('focus', handleCancel, { once: true });
    input.click();
  });
}

export async function transferVideoBinary(
  uploadUrl: string,
  asset: SelectedVideoAsset,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const payload = asset.webFile ?? await (await fetch(asset.uri)).blob();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', asset.contentType);

    const onAbort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : asset.size;
      if (total > 0) {
        onProgress((event.loaded / total) * 100);
      }
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new StorageTransferError(xhr.status, getUploadTransferStatusError(xhr.status)));
      }
    };

    xhr.onerror = () => {
      cleanup();
      const err = new Error('The cloud storage upload endpoint could not be reached. Check network connectivity and R2 CORS settings, then retry.');
      Object.assign(err, { code: 'ERR_NETWORK' });
      reject(err);
    };

    xhr.onabort = () => {
      cleanup();
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    };

    xhr.send(payload);
  });
}
