import { isStudioChannelImageConfirmation, isStudioChannelImageUploadIntent, } from '../pages/studio/studioApi.js';
export class ChannelImageUploadError extends Error {
    stage;
    originalError;
    intent;
    constructor(stage, originalError, intent) {
        super('Channel image upload workflow failed.');
        this.name = 'ChannelImageUploadError';
        this.stage = stage;
        this.originalError = originalError;
        this.intent = intent;
    }
}
export async function uploadChannelImage(dependencies, metadata, file, onProgress) {
    let intent;
    try {
        const response = await dependencies.requestIntent(metadata);
        if (!isStudioChannelImageUploadIntent(response)) {
            throw new Error('The server did not return a valid image upload target.');
        }
        intent = response;
    }
    catch (error) {
        throw new ChannelImageUploadError('intent', error);
    }
    try {
        await dependencies.upload(intent.uploadUrl, file, onProgress);
    }
    catch (error) {
        throw new ChannelImageUploadError('upload', error, intent);
    }
    try {
        const response = await dependencies.confirm(metadata.channelId, metadata.purpose, intent.uploadToken);
        if (!isStudioChannelImageConfirmation(response, metadata.purpose)) {
            throw new Error('The server did not confirm the saved channel image.');
        }
        onProgress(100);
        return response;
    }
    catch (error) {
        throw new ChannelImageUploadError('confirmation', error, intent);
    }
}
