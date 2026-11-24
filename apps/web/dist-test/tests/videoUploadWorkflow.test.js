import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryUploadVerification, retryVideoUpload, getUploadTransferErrorMessage, normalizeUploadTitle, sanitizeUploadProgress, startVideoUpload, UploadWorkflowError, validateUploadFile, validateShortUploadFile, validateUploadTitle, validateThumbnailFile, validateThumbnailDimensions, } from '../src/api/videoUploadWorkflow.js';
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
        error.isFileTransfer &&
        error.videoId === '22222222-2222-4222-8222-222222222222');
    await retryVideoUpload(dependencies, '22222222-2222-4222-8222-222222222222', { contentType: file.type, fileSize: file.size }, file, () => undefined);
    assert.deepEqual(dependencies.calls, [
        'intent', 'upload:expired-url', 'refresh', 'upload:fresh-url', 'verify',
    ]);
});
test('video upload handles ERR_NETWORK and surfaces explicit storage/CORS diagnostic message', async () => {
    const dependencies = createDependencies();
    dependencies.upload = async () => {
        const networkError = new Error('Network Error');
        networkError.code = 'ERR_NETWORK';
        throw networkError;
    };
    await assert.rejects(startVideoUpload(dependencies, metadata, file, () => undefined, () => undefined), (error) => {
        assert.ok(error instanceof UploadWorkflowError);
        assert.equal(error.stage, 'upload');
        assert.equal(error.isFileTransfer, true);
        assert.equal(error.videoId, '22222222-2222-4222-8222-222222222222');
        const transferMessage = getUploadTransferErrorMessage(error.originalError);
        assert.equal(transferMessage, 'The cloud storage upload endpoint could not be reached. Check network connectivity and R2 CORS settings, then retry.');
        return true;
    });
});
test('direct upload errors distinguish storage network, permission, and throttling failures', () => {
    assert.match(getUploadTransferErrorMessage({ code: 'ERR_NETWORK' }) ?? '', /storage upload endpoint.*network.*CORS/i);
    assert.match(getUploadTransferErrorMessage({ response: { status: 403 } }) ?? '', /permissions.*CORS/i);
    assert.match(getUploadTransferErrorMessage({ response: { status: 429 } }) ?? '', /throttling/i);
    assert.match(getUploadTransferErrorMessage({ response: { status: 503 } }) ?? '', /temporarily unavailable/i);
    assert.equal(getUploadTransferErrorMessage({ response: { status: 400 } }), null);
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
test('upload validation rejects unsafe file metadata', () => {
    assert.equal(validateUploadFile(file), null);
    assert.match(validateUploadFile({ ...file, type: 'image/png' }) ?? '', /MP4|WebM|QuickTime/);
    assert.match(validateUploadFile({ ...file, size: 0 }) ?? '', /empty/i);
    assert.match(validateUploadFile({ ...file, size: 2 * 1024 * 1024 * 1024 + 1 }) ?? '', /2 GB/i);
});
test('Short upload validation enforces size, duration, and portrait aspect ratio', () => {
    assert.equal(validateShortUploadFile(file, 60, 1080, 1920), null);
    assert.match(validateShortUploadFile(file, 181, 1080, 1920) ?? '', /3 minutes/);
    assert.match(validateShortUploadFile(file, 60, 1920, 1080) ?? '', /9:16/);
    assert.match(validateShortUploadFile({ ...file, size: 1024 * 1024 * 1024 + 1 }, 60, 1080, 1920) ?? '', /1 GB/);
});
test('upload title is normalized and bounded', () => {
    assert.equal(normalizeUploadTitle('  My   video  '), 'My video');
    assert.equal(validateUploadTitle('  '), 'Enter a video title.');
    assert.equal(validateUploadTitle('x'.repeat(256)), 'Video titles must be 255 characters or fewer.');
    assert.equal(validateUploadTitle('  Valid title  '), null);
});
test('progress callbacks clamp values to the visible 0-100 range', async () => {
    assert.equal(sanitizeUploadProgress(-10), 0);
    assert.equal(sanitizeUploadProgress(101), 100);
    assert.equal(sanitizeUploadProgress(Number.NaN), 0);
    assert.equal(sanitizeUploadProgress(42.4), 42);
    const dependencies = createDependencies();
    const progress = [];
    dependencies.upload = async (_url, _file, onProgress) => {
        dependencies.calls.push('upload:progress');
        onProgress(-25);
        onProgress(125);
    };
    await startVideoUpload(dependencies, metadata, file, () => undefined, (value) => { progress.push(value); });
    assert.deepEqual(progress, [0, 100]);
});
test('thumbnail validation enforces supported image types, maximum size, and minimum dimensions', () => {
    assert.equal(validateThumbnailFile({ type: 'image/jpeg', size: 1024 }), null);
    assert.equal(validateThumbnailFile({ type: 'image/png', size: 1024 }), null);
    assert.equal(validateThumbnailFile({ type: 'image/webp', size: 1024 }), null);
    assert.match(validateThumbnailFile({ type: 'image/gif', size: 1024 }) ?? '', /JPEG, PNG, or WebP/);
    assert.match(validateThumbnailFile({ type: 'image/jpeg', size: 0 }) ?? '', /empty/i);
    assert.match(validateThumbnailFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }) ?? '', /5 MB/);
    // Standard video thumbnails: min 320x180
    assert.equal(validateThumbnailDimensions(1280, 720, false), null);
    assert.equal(validateThumbnailDimensions(320, 180, false), null);
    assert.match(validateThumbnailDimensions(319, 180, false) ?? '', /320 × 180/);
    assert.match(validateThumbnailDimensions(320, 179, false) ?? '', /320 × 180/);
    // Shorts thumbnails: min 180x320 and portrait 9:16 aspect ratio
    assert.equal(validateThumbnailDimensions(720, 1280, true), null);
    assert.equal(validateThumbnailDimensions(1080, 1920, true), null);
    assert.match(validateThumbnailDimensions(179, 320, true) ?? '', /180 × 320/);
    assert.match(validateThumbnailDimensions(180, 319, true) ?? '', /180 × 320/);
    assert.match(validateThumbnailDimensions(1280, 720, true) ?? '', /portrait thumbnail close to the 9:16/);
});
