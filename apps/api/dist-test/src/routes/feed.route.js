"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedRouter = void 0;
exports.createPublicVideosHandler = createPublicVideosHandler;
exports.createFeedRouter = createFeedRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const database_1 = require("@watchtube/database");
const databaseErrors_1 = require("../config/databaseErrors");
const pageQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).max(1000).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(12),
});
const searchQuerySchema = pageQuerySchema.extend({
    q: zod_1.z.string().trim().min(1).max(100),
});
function parsePageQuery(req, res) {
    const parsed = pageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ error: 'Invalid pagination parameters' });
        return null;
    }
    return parsed.data;
}
function createPublicVideosHandler(findVideos) {
    return async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 12;
            const skip = (page - 1) * limit;
            const videos = await findVideos({
                where: { status: { in: ['READY', 'PUBLISHED'] }, visibility: 'PUBLIC' },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    channel: {
                        select: { name: true, handle: true, avatarUrl: true, isVerified: true },
                    },
                },
            });
            res.status(200).json(videos);
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Discover videos are temporarily unavailable because the database is unavailable.');
        }
    };
}
function createFeedRouter(findVideos = (query) => database_1.db.video.findMany(query), findChannels = (query) => database_1.db.channel.findMany(query)) {
    const feedRouter = express_1.default.Router();
    feedRouter.get('/search', async (req, res) => {
        const parsed = searchQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Enter a search term of 1 to 100 characters and valid pagination.' });
            return;
        }
        const { q, page, limit } = parsed.data;
        const skip = (page - 1) * limit;
        try {
            const [videoMatches, channelMatches] = await Promise.all([
                findVideos({
                    where: {
                        status: { in: ['READY', 'PUBLISHED'] },
                        visibility: 'PUBLIC',
                        OR: [
                            { title: { contains: q, mode: 'insensitive' } },
                            { description: { contains: q, mode: 'insensitive' } },
                            { channel: { name: { contains: q, mode: 'insensitive' } } },
                            { channel: { handle: { contains: q, mode: 'insensitive' } } },
                        ],
                    },
                    skip,
                    take: limit + 1,
                    orderBy: [{ viewsCount: 'desc' }, { createdAt: 'desc' }],
                    include: {
                        channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
                    },
                }),
                findChannels({
                    where: {
                        OR: [
                            { name: { contains: q, mode: 'insensitive' } },
                            { handle: { contains: q, mode: 'insensitive' } },
                        ],
                    },
                    skip,
                    take: limit + 1,
                    orderBy: [{ subscriberCount: 'desc' }, { name: 'asc' }],
                    select: {
                        id: true,
                        name: true,
                        handle: true,
                        avatarUrl: true,
                        isVerified: true,
                        subscriberCount: true,
                    },
                }),
            ]);
            res.status(200).json({
                videos: videoMatches.slice(0, limit),
                channels: channelMatches.slice(0, limit),
                pagination: {
                    page,
                    limit,
                    hasMoreVideos: videoMatches.length > limit,
                    hasMoreChannels: channelMatches.length > limit,
                },
            });
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Search is temporarily unavailable because the database is unavailable.');
        }
    });
    feedRouter.get('/trending', async (req, res) => {
        const pagination = parsePageQuery(req, res);
        if (!pagination)
            return;
        const { page, limit } = pagination;
        try {
            const videos = await findVideos({
                where: {
                    status: { in: ['READY', 'PUBLISHED'] },
                    visibility: 'PUBLIC',
                    OR: [
                        { viewsCount: { gt: 0 } },
                        { likes: { some: { isDislike: false } } },
                        { comments: { some: {} } },
                    ],
                },
                skip: (page - 1) * limit,
                take: limit + 1,
                orderBy: [
                    { viewsCount: 'desc' },
                    { comments: { _count: 'desc' } },
                    { createdAt: 'desc' },
                ],
                include: {
                    channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
                },
            });
            res.status(200).json({
                videos: videos.slice(0, limit),
                pagination: { page, limit, hasMore: videos.length > limit },
            });
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Trending videos are temporarily unavailable because the database is unavailable.');
        }
    });
    return feedRouter;
}
exports.feedRouter = createFeedRouter();
