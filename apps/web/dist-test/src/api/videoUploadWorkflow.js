export const MAX_VIDEO_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
export const ALLOWED_VIDEO_UPLOAD_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
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
export function sanitizeUploadProgress(progress) {
    if (!Number.isFinite(progress))
        return 0;
    return Math.max(0, Math.min(100, Math.round(progress)));
}
export class UploadWorkflowError extends Error {
    stage;
    videoId;
    originalError;
    constructor(stage, videoId, originalError) {
        super('Video upload workflow failed');
        this.name = 'UploadWorkflowError';
        this.stage = stage;
        this.videoId = videoId;
        this.originalError = originalError;
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
        throw new UploadWorkflowError('upload', intent.videoId, error);
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
        throw new UploadWorkflowError('upload', videoId, error);
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
