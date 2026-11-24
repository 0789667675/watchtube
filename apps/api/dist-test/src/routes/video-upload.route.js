"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVideoUploadRouter = createVideoUploadRouter;
const crypto_1 = require("crypto");
const express_1 = require("express");
const zod_1 = require("zod");
const databaseErrors_1 = require("../config/databaseErrors");
const channel_image_service_1 = require("../services/channel-image.service");
const storage_service_1 = require("../services/storage.service");
const notifications_1 = require("../services/notifications");
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_SHORT_UPLOAD_SIZE = 1024 * 1024 * 1024;
const MAX_SHORT_DURATION_SECONDS = 180;
const MAX_TAGS = 20;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const QUEUE_ADD_TIMEOUT_MS = 5000;
const PROCESSING_JOB_ATTEMPTS = 3;
const PROCESSING_RETRY_DELAY_MS = 1000;
const ALLOWED_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const uploadKeyPattern = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = [
    'FILM_ANIMATION', 'AUTOS_VEHICLES', 'MUSIC', 'PETS_ANIMALS', 'SPORTS',
    'TRAVEL_EVENTS', 'GAMING', 'PEOPLE_BLOGS', 'COMEDY', 'ENTERTAINMENT',
    'NEWS_POLITICS', 'HOWTO_STYLE', 'EDUCATION', 'SCIENCE_TECH',
    'NONPROFITS_ACTIVISM', 'OTHER',
];
const metadataSchema = zod_1.z.object({
    isShort: zod_1.z.boolean().optional().default(false),
    title: zod_1.z.string().trim().min(1).max(255),
    description: zod_1.z.string().trim().max(5000).nullable().optional(),
    tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(50)).max(MAX_TAGS),
    category: zod_1.z.enum(categories),
    language: zod_1.z.string().trim().min(2).max(35),
    madeForKids: zod_1.z.boolean(),
    visibility: zod_1.z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']),
    copyrightDeclared: zod_1.z.boolean(),
});
const draftSchema = metadataSchema.extend({ channelId: zod_1.z.string().uuid() });
const metadataUpdateSchema = metadataSchema;
const uploadIntentSchema = zod_1.z.object({
    videoId: zod_1.z.string().uuid(),
    contentType: zod_1.z.enum(ALLOWED_CONTENT_TYPES),
    fileSize: zod_1.z.number().int().positive().max(MAX_UPLOAD_SIZE),
    duration: zod_1.z.number().positive().max(21600).optional(),
    width: zod_1.z.number().int().positive().max(10000).optional(),
    height: zod_1.z.number().int().positive().max(10000).optional(),
});
const refreshUploadSchema = uploadIntentSchema.pick({
    contentType: true,
    fileSize: true,
});
const thumbnailUploadSchema = zod_1.z.object({
    contentType: zod_1.z.enum(['image/jpeg', 'image/png', 'image/webp']),
    fileSize: zod_1.z.number().int().positive().max(5 * 1024 * 1024),
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
    console.error('Video upload request failed.');
    (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Video data is temporarily unavailable because the database is unavailable.');
}
function sendStorageUnavailable(res, error) {
    const details = {};
    if (typeof error === 'object' && error !== null) {
        if ('name' in error && typeof error.name === 'string')
            details.name = error.name.slice(0, 80);
        if ('Code' in error && typeof error.Code === 'string')
            details.code = error.Code.slice(0, 80);
        if ('code' in error && typeof error.code === 'string')
            details.code = error.code.slice(0, 80);
        if ('$metadata' in error) {
            const metadata = error.$metadata;
            if (typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata) {
                const status = metadata.httpStatusCode;
                if (typeof status === 'number')
                    details.status = status;
            }
        }
    }
    console.error('Video upload storage operation failed.', details);
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    const errorName = typeof error === 'object' && error !== null && 'name' in error
        ? String(error.name)
        : '';
    const errorMessage = error instanceof Error ? error.message : '';
    const status = details.status;
    let code = 'STORAGE_TEMPORARY';
    if (errorName === 'StorageUnavailableError'
        && /(not configured|missing environment|bucket configuration|configuration is invalid)/i.test(errorMessage)) {
        code = 'STORAGE_CONFIGURATION';
    }
    else if (/AccessDenied|Unauthorized|InvalidAccessKey|SignatureDoesNotMatch|403|401/i.test(`${errorCode} ${errorName}`)
        || status === 401
        || status === 403) {
        code = 'STORAGE_PERMISSION';
    }
    else if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|NetworkingError/i.test(`${errorCode} ${errorName}`)) {
        code = 'STORAGE_NETWORK';
    }
    else if (status === 429
        || /SlowDown|Throttl|TooManyRequests|RequestLimitExceeded/i.test(`${errorCode} ${errorName}`)) {
        code = 'STORAGE_THROTTLED';
    }
    const message = code === 'STORAGE_CONFIGURATION'
        ? 'Cloud storage is not configured. Configure R2 credentials and public media settings for this API environment.'
        : code === 'STORAGE_THROTTLED'
            ? 'Cloud storage is temporarily throttling requests. Wait briefly, then retry.'
            : 'Cloud storage is temporarily unavailable or rejected the request.';
    res.status(503).json({ code, error: message });
}
function createVideoUploadRouter(dependencies) {
    const router = (0, express_1.Router)();
    router.post('/videos/drafts', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const parsed = draftSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid video metadata' });
            return;
        }
        try {
            if (!await dependencies.repository.ownsChannel(parsed.data.channelId, userId)) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            const { channelId, ...metadata } = parsed.data;
            const video = await dependencies.repository.createDraft({
                channelId,
                ...metadata,
                description: metadata.description || null,
                tags: [...new Set(metadata.tags.map((tag) => tag.trim()))],
                copyrightDeclaredById: metadata.copyrightDeclared ? userId : null,
                copyrightDeclaredAt: metadata.copyrightDeclared ? new Date() : null,
            });
            res.status(201).json({ videoId: video.id, status: 'DRAFT' });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
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
    const optionalAuthenticate = (req, res, next) => {
        if (!req.cookies?.token && !req.headers.authorization) {
            next();
            return;
        }
        dependencies.authenticate(req, res, next);
    };
    router.get('/videos/:id([0-9a-fA-F-]+)', optionalAuthenticate, async (req, res, next) => {
        const userId = req.user?.id;
        if (!userId) {
            next();
            return;
        }
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        if (!id.success) {
            res.status(400).json({ error: 'Invalid video id' });
            return;
        }
        try {
            const video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                next();
                return;
            }
            res.status(200).json({
                videoId: video.id,
                isShort: video.isShort,
                channelId: video.channelId,
                title: video.title,
                description: video.description,
                tags: video.tags,
                category: video.category,
                language: video.language,
                madeForKids: video.madeForKids,
                visibility: video.visibility,
                copyrightDeclared: video.copyrightDeclared,
                copyrightReviewStatus: video.copyrightReviewStatus,
                status: video.status,
                thumbnailUrl: video.thumbnailUrl,
            });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    router.patch('/videos/:id', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        const parsed = metadataUpdateSchema.safeParse(req.body);
        if (!id.success || !parsed.success) {
            res.status(400).json({ error: 'Invalid video metadata' });
            return;
        }
        try {
            const video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                res.status(404).json({ error: 'Video not found' });
                return;
            }
            if (['REJECTED', 'BLOCKED'].includes(video.status)) {
                res.status(409).json({ error: 'This video cannot be edited or published.' });
                return;
            }
            if (video.status !== 'DRAFT' && parsed.data.isShort !== video.isShort) {
                res.status(409).json({ error: 'The Short/standard format cannot change after upload starts.' });
                return;
            }
            let publishedAssets;
            if (video.status === 'PUBLISHED' && video.visibility === 'PRIVATE' && parsed.data.visibility !== 'PRIVATE') {
                if (!video.copyrightDeclared || !video.copyrightDeclaredAt || !video.copyrightDeclaredById) {
                    res.status(409).json({ error: 'Declare that you own or have permission to upload this content before publishing.' });
                    return;
                }
                if (video.copyrightReviewStatus === 'BLOCKED'
                    || await dependencies.repository.hasBlockingCopyrightClaim(video.id)) {
                    res.status(409).json({ error: 'Publication is blocked by a verified copyright claim.' });
                    return;
                }
                try {
                    publishedAssets = await dependencies.storage.publishAssets(video.id, video.thumbnailStorageKey || undefined);
                }
                catch (error) {
                    sendStorageUnavailable(res, error);
                    return;
                }
            }
            const updated = await dependencies.repository.updateMetadata({
                videoId: id.data,
                userId,
                metadata: {
                    ...parsed.data,
                    description: parsed.data.description || null,
                    tags: [...new Set(parsed.data.tags.map((tag) => tag.trim()))],
                },
                ...(publishedAssets ? { publishedAssets } : {}),
            });
            if (!updated) {
                res.status(409).json({ error: 'Video metadata changed. Reload and retry.' });
                return;
            }
            if (video.status === 'PUBLISHED' && parsed.data.visibility === 'PRIVATE') {
                try {
                    await dependencies.storage.deletePublishedAssets(video.id);
                }
                catch (error) {
                    console.error('Published media cleanup failed after changing visibility to private.', {
                        name: error instanceof Error ? error.name : 'UnknownError',
                    });
                    res.status(503).json({
                        error: 'Video is private, but public media cleanup is incomplete. Retry the visibility update.',
                    });
                    return;
                }
            }
            res.status(200).json({ videoId: video.id, status: video.status });
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
        const { videoId, contentType, fileSize, duration, width, height } = parsed.data;
        let video = null;
        try {
            video = await dependencies.repository.findVideo(videoId);
        }
        catch (error) {
            sendInternalError(res, error);
            return;
        }
        if (!video || video.channel.userId !== userId) {
            res.status(404).json({ error: 'Video not found' });
            return;
        }
        if (video.status !== 'DRAFT' || video.rawStorageKey) {
            res.status(409).json({ error: 'This draft is not awaiting a new upload.' });
            return;
        }
        if (video.isShort) {
            if (fileSize > MAX_SHORT_UPLOAD_SIZE) {
                res.status(400).json({ error: 'Shorts must be no larger than 1 GB.' });
                return;
            }
            if (!duration || duration > MAX_SHORT_DURATION_SECONDS) {
                res.status(400).json({ error: 'Shorts must be 3 minutes or shorter.' });
                return;
            }
            if (!width || !height) {
                res.status(400).json({ error: 'Short video dimensions could not be determined.' });
                return;
            }
            const aspectRatio = width / height;
            if (aspectRatio < 0.50625 || aspectRatio > 0.61875) {
                res.status(400).json({ error: 'Choose a portrait video close to the 9:16 aspect ratio.' });
                return;
            }
        }
        let uploadTarget;
        try {
            uploadTarget = await dependencies.storage.createUploadUrl(userId, contentType, fileSize, `uploads/${userId}/${(0, crypto_1.randomUUID)()}`);
        }
        catch (error) {
            sendStorageUnavailable(res, error);
            return;
        }
        try {
            const started = await dependencies.repository.setUploadTarget({
                videoId,
                userId,
                rawStorageKey: uploadTarget.fileKey,
                contentType,
                fileSize,
            });
            if (!started) {
                res.status(409).json({ error: 'This draft is not awaiting a new upload.' });
                return;
            }
            res.status(201).json({
                videoId,
                uploadUrl: uploadTarget.uploadUrl,
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
        let video;
        try {
            video = await dependencies.repository.findVideo(id.data);
        }
        catch (error) {
            sendInternalError(res, error);
            return;
        }
        if (!video || video.channel.userId !== userId) {
            res.status(404).json({ error: 'Video not found' });
            return;
        }
        if (video.status !== 'UPLOADING'
            || !video.rawStorageKey
            || !isOwnedUploadKey(video.rawStorageKey, userId)
            || video.uploadContentType !== parsed.data.contentType
            || Number(video.uploadFileSize) !== parsed.data.fileSize) {
            res.status(409).json({ error: 'Video is not awaiting an upload' });
            return;
        }
        const { contentType, fileSize } = parsed.data;
        try {
            const { uploadUrl } = await dependencies.storage.createUploadUrl(userId, contentType, fileSize, video.rawStorageKey);
            res.status(200).json({ uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS });
        }
        catch (error) {
            sendStorageUnavailable(res, error);
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
        let video;
        try {
            video = await dependencies.repository.findVideo(id.data);
        }
        catch (error) {
            sendInternalError(res, error);
            return;
        }
        if (!video || video.channel.userId !== userId) {
            res.status(404).json({ error: 'Video not found' });
            return;
        }
        if (!video.rawStorageKey || !isOwnedUploadKey(video.rawStorageKey, userId)) {
            res.status(403).json({ error: 'Upload key does not belong to this user' });
            return;
        }
        if (video.status === 'UPLOADING' || video.status === 'FAILED') {
            let uploadedObject;
            try {
                uploadedObject = await dependencies.storage.inspectObject(video.rawStorageKey);
            }
            catch (error) {
                sendStorageUnavailable(res, error);
                return;
            }
            if (!uploadedObject) {
                res.status(409).json({ error: 'Uploaded file was not found. Retry the upload.' });
                return;
            }
            if (!uploadedObject.contentLength
                || uploadedObject.contentLength > MAX_UPLOAD_SIZE
                || (video.isShort && uploadedObject.contentLength > MAX_SHORT_UPLOAD_SIZE)
                || uploadedObject.contentLength !== Number(video.uploadFileSize)
                || uploadedObject.contentType !== video.uploadContentType
                || !ALLOWED_CONTENT_TYPES.some((contentType) => contentType === uploadedObject.contentType)) {
                res.status(400).json({ error: 'Uploaded file metadata is invalid' });
                return;
            }
            let markedUploaded;
            try {
                markedUploaded = await dependencies.repository.markUploaded(id.data);
            }
            catch (error) {
                sendInternalError(res, error);
                return;
            }
            if (!markedUploaded) {
                try {
                    const currentVideo = await dependencies.repository.findVideo(id.data);
                    if (!currentVideo || currentVideo.channel.userId !== userId) {
                        res.status(404).json({ error: 'Video not found' });
                        return;
                    }
                    if (!['UPLOADED', 'PROCESSING', 'READY_FOR_REVIEW', 'PUBLISHED'].includes(currentVideo.status)) {
                        if (currentVideo.status === 'READY') {
                            res.status(200).json({ videoId: currentVideo.id, status: currentVideo.status });
                            return;
                        }
                        res.status(409).json({ error: 'Video is no longer awaiting verification' });
                        return;
                    }
                    video = currentVideo;
                }
                catch (error) {
                    sendInternalError(res, error);
                    return;
                }
            }
            else {
                video = { ...video, status: 'UPLOADED' };
            }
        }
        else if (!['UPLOADED', 'PROCESSING'].includes(video.status)) {
            if (['READY', 'READY_FOR_REVIEW', 'PUBLISHED'].includes(video.status)) {
                res.status(200).json({ videoId: video.id, status: video.status });
                return;
            }
            res.status(409).json({ error: 'Video is not awaiting verification' });
            return;
        }
        if (video.status === 'UPLOADED') {
            if (!dependencies.isQueueReady()) {
                res.status(503).json({ error: 'The video processing queue is unavailable. Retry verification when it reconnects.' });
                return;
            }
            let processingAttempt;
            try {
                processingAttempt = await dependencies.repository.markProcessing(id.data);
            }
            catch (error) {
                sendInternalError(res, error);
                return;
            }
            if (processingAttempt === null) {
                try {
                    const currentVideo = await dependencies.repository.findVideo(id.data);
                    if (!currentVideo || currentVideo.channel.userId !== userId) {
                        res.status(404).json({ error: 'Video not found' });
                        return;
                    }
                    if (currentVideo.status !== 'PROCESSING') {
                        if (['READY', 'READY_FOR_REVIEW', 'PUBLISHED'].includes(currentVideo.status)) {
                            res.status(200).json({ videoId: currentVideo.id, status: currentVideo.status });
                            return;
                        }
                        res.status(409).json({ error: 'Video is no longer awaiting verification' });
                        return;
                    }
                    video = currentVideo;
                }
                catch (error) {
                    sendInternalError(res, error);
                    return;
                }
            }
            else {
                video = { ...video, status: 'PROCESSING', processingAttempts: processingAttempt };
            }
        }
        if (!dependencies.isQueueReady()) {
            res.status(503).json({ error: 'The video processing queue is unavailable. Retry verification when it reconnects.' });
            return;
        }
        if (!video.rawStorageKey || !isOwnedUploadKey(video.rawStorageKey, userId)) {
            res.status(403).json({ error: 'Upload key does not belong to this user' });
            return;
        }
        const rawStorageKey = video.rawStorageKey;
        const jobId = video.processingAttempts <= 1
            ? video.id
            : `${video.id}-retry-${video.processingAttempts}`;
        let queueTimeout;
        try {
            await Promise.race([
                dependencies.queue.add('processVideo', { videoId: video.id, rawStorageKey }, {
                    jobId,
                    attempts: PROCESSING_JOB_ATTEMPTS,
                    backoff: { type: 'exponential', delay: PROCESSING_RETRY_DELAY_MS },
                }),
                new Promise((_resolve, reject) => {
                    queueTimeout = setTimeout(() => reject(new Error('Video processing queue timed out')), QUEUE_ADD_TIMEOUT_MS);
                }),
            ]);
            res.status(202).json({ videoId: video.id, status: 'PROCESSING' });
        }
        catch (error) {
            console.error('Video processing queue submission failed.', {
                name: error instanceof Error ? error.name : 'UnknownError',
            });
            res.status(503).json({ error: 'The video processing queue is unavailable. Retry verification when it reconnects.' });
        }
        finally {
            if (queueTimeout)
                clearTimeout(queueTimeout);
        }
    });
    router.post('/videos/:id/thumbnail-upload-intent', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        const parsed = thumbnailUploadSchema.safeParse(req.body);
        if (!id.success || !parsed.success) {
            res.status(400).json({ error: 'Invalid thumbnail upload metadata' });
            return;
        }
        try {
            const video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                res.status(404).json({ error: 'Video not found' });
                return;
            }
            if (['REJECTED', 'BLOCKED'].includes(video.status)) {
                res.status(409).json({ error: 'This video cannot be edited.' });
                return;
            }
            const target = await dependencies.storage.createThumbnailUploadTarget(video.id, parsed.data.contentType, parsed.data.fileSize);
            const saved = await dependencies.repository.setPendingThumbnailUpload({
                videoId: video.id,
                userId,
                key: target.storageKey,
                contentType: parsed.data.contentType,
                fileSize: parsed.data.fileSize,
            });
            if (!saved) {
                res.status(409).json({ error: 'Video metadata changed. Retry the thumbnail upload.' });
                return;
            }
            res.status(201).json({ uploadUrl: target.uploadUrl, expiresIn: target.expiresIn });
        }
        catch (error) {
            sendStorageUnavailable(res, error);
        }
    });
    router.post('/videos/:id/thumbnail-confirmation', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        const parsed = thumbnailUploadSchema.safeParse(req.body);
        if (!id.success || !parsed.success) {
            res.status(400).json({ error: 'Invalid thumbnail upload metadata' });
            return;
        }
        try {
            const video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                res.status(404).json({ error: 'Video not found' });
                return;
            }
            if (!video.pendingThumbnailStorageKey
                || video.pendingThumbnailContentType !== parsed.data.contentType
                || Number(video.pendingThumbnailFileSize) !== parsed.data.fileSize) {
                res.status(409).json({ error: 'No matching thumbnail upload is awaiting confirmation.' });
                return;
            }
            const exists = await dependencies.storage.normalizeThumbnail(video.pendingThumbnailStorageKey, parsed.data.contentType, parsed.data.fileSize, video.isShort);
            if (!exists) {
                res.status(409).json({ error: 'Uploaded thumbnail was not found. Retry the upload.' });
                return;
            }
            const saved = await dependencies.repository.confirmThumbnailUpload(video.id, userId, video.pendingThumbnailStorageKey);
            if (!saved) {
                res.status(409).json({ error: 'Video metadata changed. Retry the thumbnail upload.' });
                return;
            }
            res.status(200).json({ videoId: video.id, status: video.status });
        }
        catch (error) {
            if (error instanceof channel_image_service_1.InvalidChannelImageError) {
                res.status(400).json({ error: error.message });
                return;
            }
            sendStorageUnavailable(res, error);
        }
    });
    router.post('/videos/:id/publish', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = zod_1.z.string().uuid().safeParse(req.params.id);
        if (!id.success) {
            res.status(400).json({ error: 'Invalid video id' });
            return;
        }
        let video = null;
        try {
            video = await dependencies.repository.findVideo(id.data);
            if (!video || video.channel.userId !== userId) {
                res.status(404).json({ error: 'Video not found' });
                return;
            }
            if (!video.copyrightDeclared || !video.copyrightDeclaredAt || !video.copyrightDeclaredById) {
                res.status(409).json({ error: 'Declare that you own or have permission to upload this content before publishing.' });
                return;
            }
            if (video.copyrightReviewStatus === 'BLOCKED'
                || await dependencies.repository.hasBlockingCopyrightClaim(video.id)) {
                res.status(409).json({ error: 'Publication is blocked by a verified copyright claim.' });
                return;
            }
            if (!['READY_FOR_REVIEW', 'PUBLISHED'].includes(video.status)) {
                res.status(409).json({ error: 'Video processing must finish before publication.' });
                return;
            }
            let assets;
            if (video.visibility !== 'PRIVATE') {
                try {
                    assets = await dependencies.storage.publishAssets(video.id, video.thumbnailStorageKey || undefined);
                }
                catch (error) {
                    sendStorageUnavailable(res, error);
                    return;
                }
            }
            const published = await dependencies.repository.publishVideo({
                videoId: video.id,
                thumbnailUrl: assets?.thumbnailUrl,
                playlistUrls: assets?.playlistUrls,
            });
            if (!published) {
                if (assets)
                    await dependencies.storage.deletePublishedAssets(video.id);
                res.status(409).json({ error: 'Video could not be published. Reload and retry.' });
                return;
            }
            void (0, notifications_1.emitPlatformEvent)({
                eventId: (0, crypto_1.randomUUID)(),
                eventType: 'VIDEO_PUBLISHED',
                userId: video.channel.userId,
                videoId: video.id,
                videoTitle: video.title,
                channelId: video.channelId,
                timestamp: new Date(),
            });
            res.status(200).json({
                videoId: video.id,
                status: 'PUBLISHED',
                copyrightReviewStatus: video.copyrightReviewStatus,
            });
        }
        catch (error) {
            if (error instanceof storage_service_1.StorageUnavailableError) {
                sendStorageUnavailable(res, error);
                return;
            }
            if (video && video.status === 'READY_FOR_REVIEW' && video.visibility !== 'PRIVATE') {
                try {
                    await dependencies.storage.deletePublishedAssets(video.id);
                }
                catch (cleanupError) {
                    console.error('Failed to clean up video assets after publication failed.', {
                        name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
                    });
                }
            }
            sendInternalError(res, error);
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
                copyrightReviewStatus: video.copyrightReviewStatus,
            });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    return router;
}
