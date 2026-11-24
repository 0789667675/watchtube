"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedRouter = void 0;
exports.rankTrendingVideos = rankTrendingVideos;
exports.buildTrendingQuery = buildTrendingQuery;
exports.createPublicVideosHandler = createPublicVideosHandler;
exports.createFeedRouter = createFeedRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const database_1 = require("@watchtube/database");
const databaseErrors_1 = require("../config/databaseErrors");
const auth_1 = require("../middleware/auth");
const publicContent_1 = require("../security/publicContent");
const recommendation_service_1 = require("../services/recommendation.service");
const TRENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TRENDING_WEIGHTS = { view: 1, like: 3, comment: 4 };
function rankTrendingVideos(videos) {
    const score = (video) => (video._count.viewEvents * TRENDING_WEIGHTS.view
        + video._count.likes * TRENDING_WEIGHTS.like
        + video._count.comments * TRENDING_WEIGHTS.comment);
    return [...videos].sort((left, right) => (score(right) - score(left)
        || (right.publishedAt ?? right.createdAt).getTime() - (left.publishedAt ?? left.createdAt).getTime()
        || left.id.localeCompare(right.id)));
}
function buildTrendingQuery({ windowStart, take, skip }) {
    return database_1.Prisma.sql `
    WITH eligible_videos AS (
      SELECT
        video."id",
        video."title",
        video."description",
        video."thumbnailUrl",
        video."duration",
        video."viewsCount",
        video."createdAt",
        video."publishedAt",
        jsonb_build_object(
          'name', channel."name",
          'handle', channel."handle",
          'avatarUrl', channel."avatarUrl",
          'isVerified', channel."isVerified"
        ) AS "channel"
      FROM "Video" AS video
      INNER JOIN "Channel" AS channel ON channel."id" = video."channelId"
      INNER JOIN "User" AS creator ON creator."id" = channel."userId"
      WHERE video."status" IN ('READY', 'PUBLISHED')
        AND video."visibility" = 'PUBLIC'
        AND video."copyrightReviewStatus" <> 'BLOCKED'
        AND creator."status" NOT IN ('RESTRICTED', 'SUSPENDED')
        AND video."isShort" = FALSE
    ),
    recent_valid_views AS (
      SELECT view_event."videoId", COUNT(*)::INTEGER AS "activityCount"
      FROM "VideoViewEvent" AS view_event
      INNER JOIN eligible_videos AS video ON video."id" = view_event."videoId"
      WHERE view_event."isValidView" = TRUE AND view_event."createdAt" >= ${windowStart}
      GROUP BY view_event."videoId"
    ),
    recent_likes AS (
      SELECT video_like."videoId", COUNT(*)::INTEGER AS "activityCount"
      FROM "VideoLike" AS video_like
      INNER JOIN eligible_videos AS video ON video."id" = video_like."videoId"
      WHERE video_like."isDislike" = FALSE AND video_like."createdAt" >= ${windowStart}
      GROUP BY video_like."videoId"
    ),
    recent_comments AS (
      SELECT video_comment."videoId", COUNT(*)::INTEGER AS "activityCount"
      FROM "Comment" AS video_comment
      INNER JOIN eligible_videos AS video ON video."id" = video_comment."videoId"
      WHERE video_comment."createdAt" >= ${windowStart}
      GROUP BY video_comment."videoId"
    )
    SELECT video.*
    FROM eligible_videos AS video
    LEFT JOIN recent_valid_views AS views ON views."videoId" = video."id"
    LEFT JOIN recent_likes AS likes ON likes."videoId" = video."id"
    LEFT JOIN recent_comments AS comments ON comments."videoId" = video."id"
    WHERE COALESCE(views."activityCount", 0) > 0
      OR COALESCE(likes."activityCount", 0) > 0
      OR COALESCE(comments."activityCount", 0) > 0
    ORDER BY (
      COALESCE(views."activityCount", 0) * ${TRENDING_WEIGHTS.view}
      + COALESCE(likes."activityCount", 0) * ${TRENDING_WEIGHTS.like}
      + COALESCE(comments."activityCount", 0) * ${TRENDING_WEIGHTS.comment}
    ) DESC,
      COALESCE(video."publishedAt", video."createdAt") DESC,
      video."id" ASC
    LIMIT ${take}
    OFFSET ${skip}
  `;
}
function findTrendingVideos(query) {
    return database_1.db.$queryRaw(buildTrendingQuery(query));
}
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
                where: publicContent_1.publicDiscoveryVideoWhere,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: publicContent_1.publicVideoSelect,
            });
            res.status(200).json(videos);
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Discover videos are temporarily unavailable because the database is unavailable.');
        }
    };
}
function createFeedRouter(findVideos = (query) => database_1.db.video.findMany(query), findChannels = (query) => database_1.db.channel.findMany(query), findRankedVideos = findTrendingVideos, findForYou = (0, recommendation_service_1.createForYouService)(), authenticateOptional = auth_1.optionalAuthenticate) {
    const feedRouter = express_1.default.Router();
    feedRouter.get('/for-you', authenticateOptional, async (req, res) => {
        const pagination = parsePageQuery(req, res);
        if (!pagination)
            return;
        try {
            const result = await findForYou({ userId: req.user?.id, ...pagination });
            res.status(200).json(result);
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'For You recommendations are temporarily unavailable because the database is unavailable.');
        }
    });
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
                        ...publicContent_1.publicDiscoveryVideoWhere,
                        OR: [
                            { title: { contains: q, mode: 'insensitive' } },
                            { description: { contains: q, mode: 'insensitive' } },
                            { channel: { name: { contains: q, mode: 'insensitive' } } },
                            { channel: { handle: { contains: q, mode: 'insensitive' } } },
                        ],
                    },
                    skip,
                    take: limit + 1,
                    orderBy: [{ viewsCount: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
                    select: publicContent_1.publicVideoSelect,
                }),
                findChannels({
                    where: {
                        user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } },
                        OR: [
                            { name: { contains: q, mode: 'insensitive' } },
                            { handle: { contains: q, mode: 'insensitive' } },
                        ],
                    },
                    skip,
                    take: limit + 1,
                    orderBy: [{ subscriberCount: 'desc' }, { name: 'asc' }, { id: 'asc' }],
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
            const windowStart = new Date(Date.now() - TRENDING_WINDOW_MS);
            const skip = (page - 1) * limit;
            const rankedVideos = await findRankedVideos({ windowStart, take: limit + 1, skip });
            const hasMore = rankedVideos.length > limit;
            const videos = rankedVideos.slice(0, limit);
            res.status(200).json({
                videos,
                pagination: { page, limit, hasMore },
            });
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Trending videos are temporarily unavailable because the database is unavailable.');
        }
    });
    feedRouter.get('/shorts', async (req, res) => {
        const parsed = pageQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid pagination parameters' });
            return;
        }
        const { page, limit } = parsed.data;
        const skip = (page - 1) * limit;
        try {
            const matches = await findVideos({
                where: {
                    ...publicContent_1.publicDiscoveryVideoWhere,
                    isShort: true,
                },
                skip,
                take: limit + 1,
                orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
                select: publicContent_1.publicVideoSelect,
            });
            res.status(200).json({
                videos: matches.slice(0, limit),
                pagination: {
                    page,
                    limit,
                    hasMore: matches.length > limit,
                },
            });
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Shorts are temporarily unavailable because the database is unavailable.');
        }
    });
    return feedRouter;
}
exports.feedRouter = createFeedRouter();
