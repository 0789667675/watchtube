"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChannelImageUploadRouter = createChannelImageUploadRouter;
const express_1 = require("express");
const jsonwebtoken_1 = require("jsonwebtoken");
const zod_1 = require("zod");
const channel_image_service_1 = require("../services/channel-image.service");
const storage_service_1 = require("../services/storage.service");
const databaseErrors_1 = require("../config/databaseErrors");
const PURPOSES = ['avatar', 'banner'];
const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const routeParamsSchema = zod_1.z.object({
    channelId: zod_1.z.string().uuid(),
    purpose: zod_1.z.enum(PURPOSES),
});
const intentBodySchema = zod_1.z.object({
    contentType: zod_1.z.enum(CONTENT_TYPES),
    fileSize: zod_1.z.number().int().positive(),
}).strict();
const confirmationBodySchema = zod_1.z.object({
    uploadToken: zod_1.z.string().min(1).max(4096),
}).strict();
const ticketClaimsSchema = zod_1.z.object({
    channelId: zod_1.z.string().uuid(),
    purpose: zod_1.z.enum(PURPOSES),
    contentType: zod_1.z.enum(CONTENT_TYPES),
    fileSize: zod_1.z.number().int().positive(),
    uploadId: zod_1.z.string().uuid(),
    sub: zod_1.z.string().uuid(),
});
function getUserId(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return undefined;
    }
    return userId;
}
function sendRepositoryError(res, error) {
    console.error('Channel image settings could not be persisted.');
    (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Channel settings are temporarily unavailable because the database is unavailable.');
}
function sendStorageError(res, error) {
    console.error('Channel image storage operation failed.');
    if (error instanceof storage_service_1.StorageUnavailableError) {
        res.status(503).json({ error: error.message });
        return;
    }
    res.status(503).json({ error: 'Channel image upload is temporarily unavailable.' });
}
function getTicketClaims(token, ticketSecret) {
    try {
        const payload = (0, jsonwebtoken_1.verify)(token, ticketSecret, {
            algorithms: ['HS256'],
            audience: 'channel-image-upload',
            issuer: 'watchtube-api',
        });
        if (typeof payload === 'string')
            return null;
        const parsed = ticketClaimsSchema.safeParse(payload);
        return parsed.success ? parsed.data : null;
    }
    catch {
        return null;
    }
}
function createChannelImageUploadRouter(dependencies) {
    const router = (0, express_1.Router)();
    router.post('/:channelId/images/:purpose/upload-intent', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const params = routeParamsSchema.safeParse(req.params);
        const body = intentBodySchema.safeParse(req.body);
        if (!params.success || !body.success) {
            res.status(400).json({ error: 'Invalid channel image upload request.' });
            return;
        }
        const { channelId, purpose } = params.data;
        const { contentType, fileSize } = body.data;
        if (fileSize > channel_image_service_1.CHANNEL_IMAGE_MAX_FILE_SIZE[purpose]) {
            res.status(400).json({ error: 'The selected image exceeds the file size limit.' });
            return;
        }
        let ownsChannel;
        try {
            ownsChannel = await dependencies.repository.ownsChannel(channelId, userId);
        }
        catch (error) {
            sendRepositoryError(res, error);
            return;
        }
        if (!ownsChannel) {
            res.status(404).json({ error: 'Channel not found.' });
            return;
        }
        let target;
        try {
            target = await dependencies.storage.createUploadTarget({
                channelId,
                purpose,
                contentType,
                fileSize,
            });
        }
        catch (error) {
            if (error instanceof channel_image_service_1.InvalidChannelImageError) {
                res.status(400).json({ error: error.message });
                return;
            }
            sendStorageError(res, error);
            return;
        }
        const uploadToken = (0, jsonwebtoken_1.sign)({
            channelId,
            purpose,
            contentType,
            fileSize,
            uploadId: target.uploadId,
        }, dependencies.ticketSecret, {
            algorithm: 'HS256',
            audience: 'channel-image-upload',
            expiresIn: target.expiresIn,
            issuer: 'watchtube-api',
            subject: userId,
        });
        res.status(201).json({
            uploadUrl: target.uploadUrl,
            uploadToken,
            expiresIn: target.expiresIn,
        });
    });
    router.post('/:channelId/images/:purpose/confirm', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const params = routeParamsSchema.safeParse(req.params);
        const body = confirmationBodySchema.safeParse(req.body);
        if (!params.success || !body.success) {
            res.status(400).json({ error: 'Invalid channel image confirmation request.' });
            return;
        }
        const { channelId, purpose } = params.data;
        const claims = getTicketClaims(body.data.uploadToken, dependencies.ticketSecret);
        if (!claims
            || claims.channelId !== channelId
            || claims.purpose !== purpose
            || claims.sub !== userId
            || claims.fileSize > channel_image_service_1.CHANNEL_IMAGE_MAX_FILE_SIZE[purpose]) {
            res.status(400).json({ error: 'The channel image upload ticket is invalid or expired.' });
            return;
        }
        try {
            if (!(await dependencies.repository.ownsChannel(channelId, userId))) {
                res.status(404).json({ error: 'Channel not found.' });
                return;
            }
        }
        catch (error) {
            sendRepositoryError(res, error);
            return;
        }
        let imageUrl;
        try {
            imageUrl = await dependencies.storage.publishUploadedImage({
                channelId,
                purpose,
                contentType: claims.contentType,
                fileSize: claims.fileSize,
                uploadId: claims.uploadId,
            });
        }
        catch (error) {
            if (error instanceof channel_image_service_1.InvalidChannelImageError) {
                res.status(400).json({ error: error.message });
                return;
            }
            sendStorageError(res, error);
            return;
        }
        if (!imageUrl) {
            res.status(409).json({ error: 'The uploaded image was not found. Upload it before confirming.' });
            return;
        }
        try {
            const channel = await dependencies.repository.updateOwnedImage(channelId, userId, purpose, imageUrl);
            if (!channel) {
                res.status(404).json({ error: 'Channel not found.' });
                return;
            }
            res.status(200).json({ channel, imageUrl });
        }
        catch (error) {
            sendRepositoryError(res, error);
        }
    });
    return router;
}
