"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCreatorCommentsRouter = createCreatorCommentsRouter;
const express_1 = require("express");
const zod_1 = require("zod");
const databaseErrors_1 = require("../config/databaseErrors");
const listQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(20),
    search: zod_1.z.string().trim().max(200).optional(),
});
function getUserId(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return undefined;
    }
    return userId;
}
function sendInternalError(res, error) {
    console.error('Creator comment moderation request failed.');
    (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Creator comments are temporarily unavailable because the database is unavailable.');
}
function createCreatorCommentsRouter(dependencies) {
    const router = (0, express_1.Router)();
    router.get('/channels/:channelId/comments', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const channelId = zod_1.z.string().uuid().safeParse(req.params.channelId);
        const query = listQuerySchema.safeParse(req.query);
        if (!channelId.success || !query.success) {
            res.status(400).json({ error: 'Invalid comment query' });
            return;
        }
        try {
            if (!(await dependencies.repository.ownsChannel(channelId.data, userId))) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            const { comments, total } = await dependencies.repository.listComments({
                channelId: channelId.data,
                userId,
                page: query.data.page,
                limit: query.data.limit,
                ...(query.data.search ? { search: query.data.search } : {}),
            });
            res.status(200).json({
                comments,
                page: query.data.page,
                limit: query.data.limit,
                total,
                totalPages: Math.ceil(total / query.data.limit),
            });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    router.delete('/channels/:channelId/comments/:commentId', dependencies.authenticate, async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const params = zod_1.z.object({
            channelId: zod_1.z.string().uuid(),
            commentId: zod_1.z.string().uuid(),
        }).safeParse(req.params);
        if (!params.success) {
            res.status(400).json({ error: 'Invalid comment request' });
            return;
        }
        try {
            if (!(await dependencies.repository.ownsChannel(params.data.channelId, userId))) {
                res.status(404).json({ error: 'Channel not found' });
                return;
            }
            const deleted = await dependencies.repository.deleteComment({
                channelId: params.data.channelId,
                commentId: params.data.commentId,
                userId,
            });
            if (!deleted) {
                res.status(404).json({ error: 'Comment not found' });
                return;
            }
            res.status(200).json({ deleted: true, commentId: params.data.commentId });
        }
        catch (error) {
            sendInternalError(res, error);
        }
    });
    return router;
}
