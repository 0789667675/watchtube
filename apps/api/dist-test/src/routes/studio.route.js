"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.studioRouter = void 0;
exports.createStudioRouter = createStudioRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const database_1 = require("@watchtube/database");
const auth_1 = require("../middleware/auth");
const databaseErrors_1 = require("../config/databaseErrors");
const dateSchema = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid YYYY-MM-DD date.');
const querySchema = zod_1.z.object({
    channelId: zod_1.z.string().uuid().optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
}).strict();
function defaultPeriod(now = new Date()) {
    const today = now.toISOString().slice(0, 10);
    const from = new Date(`${today}T00:00:00.000Z`);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: from.toISOString().slice(0, 10), to: today };
}
function createStudioRouter(authenticateMiddleware, repository) {
    const router = express_1.default.Router();
    router.get('/analytics', authenticateMiddleware, async (req, res) => {
        const parsed = querySchema.safeParse(req.query);
        if (!parsed.success || Boolean(parsed.data?.from) !== Boolean(parsed.data?.to)) {
            res.status(400).json({ error: 'Provide a valid channel and a complete date range.' });
            return;
        }
        const defaults = defaultPeriod();
        const from = parsed.data.from ?? defaults.from;
        const to = parsed.data.to ?? defaults.to;
        const fromDate = new Date(`${from}T00:00:00.000Z`);
        const toExclusive = new Date(`${to}T00:00:00.000Z`);
        toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
        if (toExclusive <= fromDate || toExclusive.getTime() - fromDate.getTime() > 366 * 24 * 60 * 60 * 1000) {
            res.status(400).json({ error: 'The date range must be ordered and no longer than 366 days.' });
            return;
        }
        try {
            const channel = await repository.findOwnedChannel(req.user.id, parsed.data.channelId);
            if (!channel)
                return res.status(404).json({ error: 'Channel not found' });
            const analytics = await repository.getAnalytics(channel.id, { from: fromDate, toExclusive });
            res.status(200).json({
                period: { from, to },
                subscriberCount: channel.subscriberCount,
                ...analytics,
            });
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Channel analytics are temporarily unavailable because the database is unavailable.');
        }
    });
    return router;
}
exports.studioRouter = createStudioRouter(auth_1.authenticate, {
    async findOwnedChannel(userId, channelId) {
        return database_1.db.channel.findFirst({
            where: { userId, ...(channelId ? { id: channelId } : {}) },
            select: { id: true, subscriberCount: true },
            orderBy: { createdAt: 'asc' },
        });
    },
    async getAnalytics(channelId, period) {
        const dateFilter = { gte: period.from, lt: period.toExclusive };
        const views = await database_1.db.videoViewEvent.groupBy({
            by: ['videoId'],
            where: {
                video: { channelId },
                isValidView: true,
                createdAt: dateFilter,
            },
            _count: { _all: true },
            _sum: { watchDurationSeconds: true },
        });
        const sortedViews = [...views].sort((a, b) => b._count._all - a._count._all).slice(0, 10);
        const videoIds = sortedViews.map((item) => item.videoId);
        const [videos, likes, comments] = videoIds.length
            ? await Promise.all([
                database_1.db.video.findMany({
                    where: { id: { in: videoIds }, channelId },
                    select: { id: true, title: true },
                }),
                database_1.db.videoLike.groupBy({
                    by: ['videoId'],
                    where: {
                        videoId: { in: videoIds },
                        isDislike: false,
                        createdAt: dateFilter,
                    },
                    _count: { _all: true },
                }),
                database_1.db.comment.groupBy({
                    by: ['videoId'],
                    where: { videoId: { in: videoIds }, createdAt: dateFilter },
                    _count: { _all: true },
                }),
            ])
            : [[], [], []];
        const titleById = new Map(videos.map((video) => [video.id, video.title]));
        const likesById = new Map(likes.map((item) => [item.videoId, item._count._all]));
        const commentsById = new Map(comments.map((item) => [item.videoId, item._count._all]));
        const recentPerformance = sortedViews.flatMap((item) => {
            const title = titleById.get(item.videoId);
            if (title === undefined)
                return [];
            return [{
                    id: item.videoId,
                    title,
                    views: item._count._all,
                    watchHours: (item._sum.watchDurationSeconds ?? 0) / 3600,
                    _count: {
                        likes: likesById.get(item.videoId) ?? 0,
                        comments: commentsById.get(item.videoId) ?? 0,
                    },
                }];
        });
        return {
            totalViews: views.reduce((total, item) => total + item._count._all, 0),
            totalWatchHours: views.reduce((total, item) => total + (item._sum.watchDurationSeconds ?? 0), 0) / 3600,
            recentPerformance,
        };
    },
});
