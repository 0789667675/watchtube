import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryUploadVerification, retryVideoUpload, startVideoUpload, UploadWorkflowError, } from '../src/api/videoUploadWorkflow.js';
const file = { name: 'clip.mp4', size: 1024, type: 'video/mp4' };
const metadata = {
    title: 'Test video',
    contentType: file.type,
    fileSize: file.size,
    channelId: '11111111-1111-4111-8111-111111111111',
};
function createDependencies() {
    const calls = [];
    return {
        calls,
        requestIntent: async () => {
            calls.push('intent');
            return { videoId: '22222222-2222-4222-8222-222222222222', uploadUrl: 'expired-url' };
        },
        refreshUploadUrl: async () => {
            calls.push('refresh');
            return 'fresh-url';
        },
        upload: async (url, _file, onProgress) => {
            calls.push(`upload:${url}`);
            onProgress(100);
        },
        verify: async () => { calls.push('verify'); },
    };
}
test('initial upload requests authorization, transfers the file, then verifies it', async () => {
    const dependencies = createDependencies();
    let createdVideoId;
    const progress = [];
    const videoId = await startVideoUpload(dependencies, metadata, file, (id) => { createdVideoId = id; }, (value) => { progress.push(value); });
    assert.equal(videoId, createdVideoId);
    assert.deepEqual(dependencies.calls, ['intent', 'upload:expired-url', 'verify']);
    assert.deepEqual(progress, [100]);
});
test('failed transfer preserves the video ID and retry obtains a fresh URL', async () => {
    const dependencies = createDependencies();
    dependencies.upload = async (url) => {
        dependencies.calls.push(`upload:${url}`);
        if (url === 'expired-url')
            throw new Error('expired');
    };
    await assert.rejects(startVideoUpload(dependencies, metadata, file, () => undefined, () => undefined), (error) => error instanceof UploadWorkflowError &&
        error.stage === 'upload' &&
        error.videoId === '22222222-2222-4222-8222-222222222222');
    await retryVideoUpload(dependencies, '22222222-2222-4222-8222-222222222222', { contentType: file.type, fileSize: file.size }, file, () => undefined);
    assert.deepEqual(dependencies.calls, [
        'intent', 'upload:expired-url', 'refresh', 'upload:fresh-url', 'verify',
    ]);
});
test('verification retry does not upload the file again', async () => {
    const dependencies = createDependencies();
    let failVerification = true;
    dependencies.verify = async () => {
        dependencies.calls.push('verify');
        if (failVerification)
            throw new Error('temporary API failure');
    };
    await assert.rejects(startVideoUpload(dependencies, metadata, file, () => undefined, () => undefined), (error) => error instanceof UploadWorkflowError && error.stage === 'verification');
    failVerification = false;
    await retryUploadVerification(dependencies, '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(dependencies.calls, ['intent', 'upload:expired-url', 'verify', 'verify']);
});
test('failed authorization does not report an upload or create a video', async () => {
    const dependencies = createDependencies();
    dependencies.requestIntent = async () => {
        dependencies.calls.push('intent');
        throw new Error('unauthorized');
    };
    await assert.rejects(startVideoUpload(dependencies, metadata, file, () => undefined, () => undefined), (error) => error instanceof UploadWorkflowError &&
        error.stage === 'intent' &&
        error.videoId === undefined);
    assert.deepEqual(dependencies.calls, ['intent']);
});
