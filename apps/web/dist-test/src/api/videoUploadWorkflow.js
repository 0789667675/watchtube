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
    let intent;
    try {
        intent = await dependencies.requestIntent(metadata);
    }
    catch (error) {
        throw new UploadWorkflowError('intent', undefined, error);
    }
    onVideoCreated(intent.videoId);
    try {
        await dependencies.upload(intent.uploadUrl, file, onProgress);
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
    let uploadUrl;
    try {
        uploadUrl = await dependencies.refreshUploadUrl(videoId, metadata);
    }
    catch (error) {
        throw new UploadWorkflowError('upload', videoId, error);
    }
    try {
        await dependencies.upload(uploadUrl, file, onProgress);
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
