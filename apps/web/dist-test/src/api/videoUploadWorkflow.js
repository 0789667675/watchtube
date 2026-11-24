export const MAX_VIDEO_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
export const MAX_SHORT_UPLOAD_SIZE = 1024 * 1024 * 1024;
export const MAX_SHORT_DURATION_SECONDS = 180;
export const ALLOWED_VIDEO_UPLOAD_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const MAX_THUMBNAIL_UPLOAD_SIZE = 5 * 1024 * 1024;
export const ALLOWED_THUMBNAIL_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MIN_THUMBNAIL_WIDTH = 320;
export const MIN_THUMBNAIL_HEIGHT = 180;
export const MIN_SHORT_THUMBNAIL_WIDTH = 180;
export const MIN_SHORT_THUMBNAIL_HEIGHT = 320;
export function normalizeUploadTitle(title) {
    return title.trim().replace(/\s+/g, ' ');
}
export function validateUploadTitle(title) {
    const normalized = normalizeUploadTitle(title);
    if (!normalized)
        return 'Enter a video title.';
    if (normalized.length > 255)
        return 'Video titles must be 255 characters or fewer.';
    return null;
}
export function validateUploadFile(file) {
    if (!ALLOWED_VIDEO_UPLOAD_TYPES.includes(file.type)) {
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
export function validateThumbnailFile(file) {
    if (!ALLOWED_THUMBNAIL_UPLOAD_TYPES.includes(file.type)) {
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
export function validateThumbnailDimensions(width, height, isShort = false) {
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
    }
    else {
        if (width < MIN_THUMBNAIL_WIDTH || height < MIN_THUMBNAIL_HEIGHT) {
            return `Thumbnails must be at least ${MIN_THUMBNAIL_WIDTH} × ${MIN_THUMBNAIL_HEIGHT} pixels.`;
        }
    }
    return null;
}
export function validateShortUploadFile(file, duration, width, height) {
    const fileError = validateUploadFile(file);
    if (fileError)
        return fileError;
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
export function sanitizeUploadProgress(progress) {
    if (!Number.isFinite(progress))
        return 0;
    return Math.max(0, Math.min(100, Math.round(progress)));
}
export function getUploadTransferErrorMessage(error) {
    if (typeof error !== 'object' || error === null)
        return null;
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
    stage;
    videoId;
    originalError;
    isFileTransfer;
    constructor(stage, videoId, originalError, isFileTransfer = false) {
        super('Video upload workflow failed');
        this.name = 'UploadWorkflowError';
        this.stage = stage;
        this.videoId = videoId;
        this.originalError = originalError;
        this.isFileTransfer = isFileTransfer;
    }
}
export async function startVideoUpload(dependencies, metadata, file, onVideoCreated, onProgress) {
    const safeProgress = (progress) => onProgress(sanitizeUploadProgress(progress));
    let intent;
    try {
        intent = await dependencies.requestIntent(metadata);
    }
    catch (error) {
        throw new UploadWorkflowError('intent', undefined, error);
    }
    onVideoCreated(intent.videoId);
    try {
        await dependencies.upload(intent.uploadUrl, file, safeProgress);
    }
    catch (error) {
        throw new UploadWorkflowError('upload', intent.videoId, error, true);
    }
    try {
        await dependencies.verify(intent.videoId);
    }
    catch (error) {
        throw new UploadWorkflowError('verification', intent.videoId, error);
    }
    return intent.videoId;
}
export async function retryVideoUpload(dependencies, videoId, metadata, file, onProgress) {
    const safeProgress = (progress) => onProgress(sanitizeUploadProgress(progress));
    let uploadUrl;
    try {
        uploadUrl = await dependencies.refreshUploadUrl(videoId, metadata);
    }
    catch (error) {
        throw new UploadWorkflowError('upload', videoId, error);
    }
    try {
        await dependencies.upload(uploadUrl, file, safeProgress);
    }
    catch (error) {
        throw new UploadWorkflowError('upload', videoId, error, true);
    }
    try {
        await dependencies.verify(videoId);
    }
    catch (error) {
        throw new UploadWorkflowError('verification', videoId, error);
    }
}
export async function retryUploadVerification(dependencies, videoId) {
    try {
        await dependencies.verify(videoId);
    }
    catch (error) {
        throw new UploadWorkflowError('verification', videoId, error);
    }
}
