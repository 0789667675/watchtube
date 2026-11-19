"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.interactionRouter = void 0;
exports.createSubscriptionFeedRouter = createSubscriptionFeedRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const database_1 = require("@watchtube/database");
const auth_1 = require("../middleware/auth");
const publicContent_1 = require("../security/publicContent");
const publicContent_2 = require("../security/publicContent");
const databaseErrors_1 = require("../config/databaseErrors");
const interactionRouter = express_1.default.Router();
exports.interactionRouter = interactionRouter;
function createSubscriptionFeedRouter(authenticateMiddleware, repository = {
    findChannelIds: async (userId) => database_1.db.subscription.findMany({
        where: { subscriberId: userId },
        select: { channelId: true },
    }),
    findVideos: (query) => database_1.db.video.findMany(query),
}) {
    const router = express_1.default.Router();
    router.get('/feed/subscriptions', authenticateMiddleware, async (req, res) => {
        try {
            const userId = req.user.id;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 12;
            const skip = (page - 1) * limit;
            const subscriptions = await repository.findChannelIds(userId);
            const channelIds = subscriptions.map((subscription) => subscription.channelId);
            const videos = await repository.findVideos({
                where: {
                    channelId: { in: channelIds },
                    status: { in: ['READY', 'PUBLISHED'] },
                    visibility: 'PUBLIC',
                },
                skip,
                take: limit,
                orderBy: { publishedAt: 'desc' },
                include: {
                    channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
                },
            });
            res.status(200).json(videos);
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Subscriptions are temporarily unavailable because the database is unavailable.');
        }
    });
    return router;
}
interactionRouter.post('/videos/:id/like', auth_1.authenticate, async (req, res) => {
    try {
        const videoId = req.params.id;
        const userId = req.user.id;
        const { isDislike } = zod_1.z.object({ isDislike: zod_1.z.boolean() }).parse(req.body);
        const video = await database_1.db.video.findFirst({
            where: (0, publicContent_2.publicVideoWhere)(videoId),
            select: { id: true },
        });
        interactionRouter.get('/videos/:id/like-status', auth_1.authenticate, async (req, res) => {
            try {
                const videoId = req.params.id;
                const video = await database_1.db.video.findFirst({
                    where: (0, publicContent_2.publicVideoWhere)(videoId),
                    select: { id: true },
                });
                if (!video)
                    return res.status(404).json({ error: 'Video not found or not available' });
                const like = await database_1.db.videoLike.findUnique({
                    where: { userId_videoId: { userId: req.user.id, videoId } },
                    select: { isDislike: true },
                });
                res.status(200).json({
                    isLiked: like ? !like.isDislike : false,
                    isDisliked: like?.isDislike ?? false,
                });
            }
            catch (error) {
                (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Video reaction status is temporarily unavailable.');
            }
        });
        if (!video)
            return res.status(404).json({ error: 'Video not found or not available' });
        const existingLike = await database_1.db.videoLike.findUnique({
            where: { userId_videoId: { userId, videoId } }
        });
        if (existingLike) {
            if (existingLike.isDislike === isDislike) {
                await database_1.db.videoLike.delete({ where: { id: existingLike.id } });
            }
            else {
                await database_1.db.videoLike.update({
                    where: { id: existingLike.id },
                    data: { isDislike }
                });
            }
        }
        else {
            await database_1.db.videoLike.create({
                data: { userId, videoId, isDislike }
            });
        }
        const updatedLike = await database_1.db.videoLike.findUnique({
            where: { userId_videoId: { userId, videoId } },
            select: { isDislike: true },
        });
        res.status(200).json({
            success: true,
            isLiked: updatedLike ? !updatedLike.isDislike : false,
            isDisliked: updatedLike?.isDislike ?? false,
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Video interaction is temporarily unavailable because the database is unavailable.');
    }
});
interactionRouter.post('/channels/:id/subscribe', auth_1.authenticate, async (req, res) => {
    try {
        const channelId = req.params.id;
        const userId = req.user.id;
        const channel = await database_1.db.channel.findUnique({ where: { id: channelId } });
        if (!channel)
            return res.status(404).json({ error: 'Channel not found' });
        if (channel.userId === userId)
            return res.status(400).json({ error: 'Cannot subscribe to own channel' });
        const existingSub = await database_1.db.subscription.findUnique({
            where: { subscriberId_channelId: { subscriberId: userId, channelId } }
        });
        if (existingSub) {
            await database_1.db.$transaction([
                database_1.db.subscription.delete({ where: { id: existingSub.id } }),
                database_1.db.channel.update({ where: { id: channelId }, data: { subscriberCount: { decrement: 1 } } })
            ]);
            res.status(200).json({ isSubscribed: false });
        }
        else {
            await database_1.db.$transaction([
                database_1.db.subscription.create({ data: { subscriberId: userId, channelId } }),
                database_1.db.channel.update({ where: { id: channelId }, data: { subscriberCount: { increment: 1 } } })
            ]);
            res.status(200).json({ isSubscribed: true });
        }
    }
    catch (error) {
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Subscription changes are temporarily unavailable because the database is unavailable.');
    }
});
interactionRouter.get('/channels/:id/subscription-status', auth_1.authenticate, async (req, res) => {
    try {
        const channelId = req.params.id;
        const userId = req.user.id;
        const existingSub = await database_1.db.subscription.findUnique({
            where: { subscriberId_channelId: { subscriberId: userId, channelId } }
        });
        res.status(200).json({ isSubscribed: !!existingSub });
    }
    catch (error) {
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Subscription status is temporarily unavailable because the database is unavailable.');
    }
});
interactionRouter.get('/videos/:id/comments', async (req, res) => {
    try {
        const videoId = req.params.id;
        const cursor = req.query.cursor;
        const limit = 20;
        const comments = await database_1.db.comment.findMany({
            where: (0, publicContent_1.publicTopLevelCommentsWhere)(videoId),
            take: limit + 1,
            cursor: cursor ? { id: cursor } : undefined,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { channels: { select: { avatarUrl: true, handle: true, name: true } } } },
                _count: { select: { replies: true } }
            }
        });
        let nextCursor = undefined;
        if (comments.length > limit) {
            const nextItem = comments.pop();
            nextCursor = nextItem.id;
        }
        res.status(200).json({ comments, nextCursor });
    }
    catch (error) {
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Comments are temporarily unavailable because the database is unavailable.');
    }
});
interactionRouter.get('/comments/:id/replies', async (req, res) => {
    try {
        const parentId = req.params.id;
        const replies = await database_1.db.comment.findMany({
            where: (0, publicContent_1.publicRepliesWhere)(parentId),
            orderBy: { createdAt: 'asc' },
            include: {
                user: { select: { channels: { select: { avatarUrl: true, handle: true, name: true } } } }
            }
        });
        res.status(200).json(replies);
    }
    catch (error) {
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Replies are temporarily unavailable because the database is unavailable.');
    }
});
interactionRouter.post('/videos/:id/comments', auth_1.authenticate, async (req, res) => {
    try {
        const videoId = req.params.id;
        const userId = req.user.id;
        const { content, parentId } = zod_1.z.object({
            content: zod_1.z.string().min(1).max(1000),
            parentId: zod_1.z.string().uuid().optional().nullable()
        }).parse(req.body);
        const video = await database_1.db.video.findFirst({
            where: (0, publicContent_2.publicVideoWhere)(videoId),
            select: { id: true },
        });
        if (!video)
            return res.status(404).json({ error: 'Video not found or not available' });
        if (parentId) {
            const parent = await database_1.db.comment.findFirst({
                where: { id: parentId, videoId, parentId: null },
                select: { id: true },
            });
            if (!parent)
                return res.status(404).json({ error: 'Parent comment not found' });
        }
        const comment = await database_1.db.comment.create({
            data: { videoId, userId, content, parentId }
        });
        res.status(201).json(comment);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Comment submission is temporarily unavailable because the database is unavailable.');
    }
});
interactionRouter.use(createSubscriptionFeedRouter(auth_1.authenticate));
