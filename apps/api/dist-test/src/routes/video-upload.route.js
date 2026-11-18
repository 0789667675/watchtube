"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVideoUploadRouter = createVideoUploadRouter;
const crypto_1 = require("crypto");
const express_1 = require("express");
const zod_1 = require("zod");
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const ALLOWED_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const uploadKeyPattern = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uploadIntentSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(255),
    contentType: zod_1.z.enum(ALLOWED_CONTENT_TYPES),
    fileSize: zod_1.z.number().int().positive().max(MAX_UPLOAD_SIZE),
    channelId: zod_1.z.string().uuid(),
});
const refreshUploadSchema = uploadIntentSchema.pick({
    contentType: true,
    fileSize: true,
});
function getUserId(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return undefined;
    }
    return userId;
}
function isOwnedUploadKey(key, userId) {
    return uploadKeyPattern.test(key) && key.startsWith(`uploads/${userId}/`);
}
function sendInternalError(res, error) {
    console.error('Video upload request failed:', error);
    res.status(500).json({ error: 'Internal server error' });
}
function createVideoUploadRouter(dependencies) {
    const router = (0, express_1.Router)();
    router.get('/videos/mine', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        try {
            res.status(200).json(await dependencies.repository.listVideos(userId));
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    router.post('/videos/upload-intent', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const parsed = uploadIntentSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid upload metadata' });
            return;
        }
        try {
            const { title, contentType, fileSize, channelId } = parsed.data;
            if (!(await dependencies.repository.ownsChannel(channelId, userId))) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            const { uploadUrl, fileKey } = await dependencies.storage.createUploadUrl(userId, contentType, fileSize, `uploads/${userId}/${(0, crypto_1.randomUUID)()}`);
            const video = await dependencies.repository.createVideo({
                channelId,
                title,
                rawStorageKey: fileKey,
                status: 'UPLOADING',
            });
            res.status(201).json({
                videoId: video.id,
                uploadUrl,
                expiresIn: UPLOAD_URL_TTL_SECONDS,
                status: 'UPLOADING',
            });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    router.post('/videos/:id/upload-url', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        const parsed = refreshUploadSchema.safeParse(req.body);
        if (!id.success || !parsed.success) {
            res.status(400).json({ error: 'Invalid upload request' });
            return;
        }
        try {
            const video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                res.status(404).json({ error: 'Video not found' });
                return;
            }
            if (video.status !== 'UPLOADING' || !isOwnedUploadKey(video.rawStorageKey, userId)) {
                res.status(409).json({ error: 'Video is not awaiting an upload' });
                return;
            }
            const { contentType, fileSize } = parsed.data;
            const { uploadUrl } = await dependencies.storage.createUploadUrl(userId, contentType, fileSize, video.rawStorageKey);
            res.status(200).json({ uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    router.post('/videos/:id/verify-upload', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        if (!id.success) {
            res.status(400).json({ error: 'Invalid video id' });
            return;
        }
        try {
            const video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                res.status(404).json({ error: 'Video not found' });
                return;
            }
            if (!isOwnedUploadKey(video.rawStorageKey, userId)) {
                res.status(403).json({ error: 'Upload key does not belong to this user' });
                return;
            }
            if (video.status === 'UPLOADING') {
                const uploadedObject = await dependencies.storage.inspectObject(video.rawStorageKey);
                if (!uploadedObject) {
                    res.status(409).json({ error: 'Uploaded file was not found. Retry the upload.' });
                    return;
                }
                if (!uploadedObject.contentLength ||
                    uploadedObject.contentLength > MAX_UPLOAD_SIZE ||
                    !ALLOWED_CONTENT_TYPES.some((contentType) => contentType === uploadedObject.contentType)) {
                    res.status(400).json({ error: 'Uploaded file metadata is invalid' });
                    return;
                }
                const markedProcessing = await dependencies.repository.markProcessing(id.data);
                if (!markedProcessing) {
                    const currentVideo = await dependencies.repository.findVideo(id.data);
                    if (!currentVideo || currentVideo.channel.userId !== userId) {
                        res.status(404).json({ error: 'Video not found' });
                        return;
                    }
                    if (currentVideo.status !== 'PROCESSING') {
                        if (currentVideo.status === 'READY') {
                            res.status(200).json({ videoId: currentVideo.id, status: currentVideo.status });
                            return;
                        }
                        res.status(409).json({ error: 'Video is no longer awaiting verification' });
                        return;
                    }
                }
            }
            else if (video.status !== 'PROCESSING') {
                if (video.status === 'READY') {
                    res.status(200).json({ videoId: video.id, status: video.status });
                    return;
                }
                res.status(409).json({ error: 'Video is not awaiting verification' });
                return;
            }
            await dependencies.queue.add('processVideo', { videoId: video.id, rawStorageKey: video.rawStorageKey }, { jobId: video.id });
            res.status(202).json({ videoId: video.id, status: 'PROCESSING' });
        }
        catch (error) {
            console.error('Video upload verification failed:', error);
            res.status(503).json({ error: 'Upload verification or processing queue is temporarily unavailable' });
        }
    });
    router.get('/videos/:id/upload-status', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        if (!id.success) {
            res.status(400).json({ error: 'Invalid video id' });
            return;
        }
        try {
            const video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                res.status(404).json({ error: 'Video not found' });
                return;
            }
            res.status(200).json({
                videoId: video.id,
                status: video.status,
                thumbnailUrl: video.thumbnailUrl,
            });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    return router;
}
