"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChannelRouter = createChannelRouter;
const express_1 = require("express");
const zod_1 = require("zod");
const handleSchema = zod_1.z.string()
    .trim()
    .transform((value) => value.startsWith('@') ? value : `@${value}`)
    .pipe(zod_1.z.string().regex(/^@[a-zA-Z0-9_]{1,30}$/, 'Use 1-30 letters, numbers, or underscores.'));
const channelCreationSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(80),
    handle: handleSchema,
    description: zod_1.z.string().trim().max(1000).nullable().optional(),
}).strict();
const channelUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(80).optional(),
    handle: handleSchema.optional(),
    description: zod_1.z.string().trim().max(1000).transform((value) => value || null).nullable().optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined), { message: 'Provide at least one channel field to update.' });
function getUserId(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return undefined;
    }
    return userId;
}
function isUniqueConstraintError(error) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'P2002';
}
function sendInternalError(res, error) {
    console.error('Channel settings request failed:', error);
    res.status(500).json({ error: 'Internal server error' });
}
function createChannelRouter(dependencies) {
    const router = (0, express_1.Router)();
    router.post('/', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const parsed = channelCreationSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid channel details' });
            return;
        }
        try {
            if (await dependencies.repository.handleExists(parsed.data.handle)) {
                res.status(409).json({ error: 'Handle already in use.' });
                return;
            }
            const channel = await dependencies.repository.createChannel({
                ...parsed.data,
                userId,
            });
            res.status(201).json(channel);
        }
        catch (error) {
            if (isUniqueConstraintError(error)) {
                res.status(409).json({ error: 'Handle already in use.' });
                return;
            }
            sendInternalError(res, error);
        }
    });
    router.get('/:channelId/settings', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const channelId = zod_1.z.string().uuid().safeParse(req.params.channelId);
        if (!channelId.success) {
            res.status(400).json({ error: 'Invalid channel ID' });
            return;
        }
        try {
            const channel = await dependencies.repository.findOwnedChannel(channelId.data, userId);
            if (!channel) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            res.status(200).json(channel);
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    router.patch('/:channelId/settings', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const channelId = zod_1.z.string().uuid().safeParse(req.params.channelId);
        const parsed = channelUpdateSchema.safeParse(req.body);
        if (!channelId.success || !parsed.success) {
            res.status(400).json({ error: 'Invalid channel update' });
            return;
        }
        try {
            const currentChannel = await dependencies.repository.findOwnedChannel(channelId.data, userId);
            if (!currentChannel) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            if (parsed.data.handle
                && parsed.data.handle !== currentChannel.handle
                && await dependencies.repository.handleExists(parsed.data.handle, channelId.data)) {
                res.status(409).json({ error: 'Handle already in use.' });
                return;
            }
            const channel = await dependencies.repository.updateOwnedChannel(channelId.data, userId, parsed.data);
            if (!channel) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            res.status(200).json(channel);
        }
        catch (error) {
            if (isUniqueConstraintError(error)) {
                res.status(409).json({ error: 'Handle already in use.' });
                return;
            }
            sendInternalError(res, error);
        }
    });
    router.get('/:handle', async (req, res) => {
        const handle = req.params.handle;
        try {
            const channel = await dependencies.repository.findPublicChannel(handle);
            if (!channel) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            res.status(200).json(channel);
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    return router;
}
