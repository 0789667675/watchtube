"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECOMMENDATION_CONFIG = void 0;
exports.rankForYouVideos = rankForYouVideos;
exports.buildRecommendationCandidateQuery = buildRecommendationCandidateQuery;
exports.buildViewerActivityQueries = buildViewerActivityQueries;
exports.createForYouService = createForYouService;
const database_1 = require("@watchtube/database");
const publicContent_1 = require("../security/publicContent");
const DAY_MS = 24 * 60 * 60 * 1000;
exports.RECOMMENDATION_CONFIG = {
    candidateLimit: 500,
    activityLimit: 100,
    activityDecayDays: 90,
    watch: {
        completed: 2.2,
        engaged: 1.2,
        brief: 0.2,
    },
    like: 2.8,
    dislike: -3.2,
    comment: 1.6,
    validView: 0.45,
    categoryRelevance: 4,
    tagRelevance: 3,
    negativeInterestScale: 0.8,
    interestConfidenceSignals: 10,
    subscribedChannelBonus: 1.25,
    recencyScaleDays: 14,
    recencyWeight: 1.1,
    popularityWeight: 0.15,
    watchedSuppression: {
        recentDays: 7,
        recentCompletedMultiplier: 0.12,
        recentIncompleteMultiplier: 0.4,
        monthDays: 30,
        monthCompletedMultiplier: 0.4,
        monthIncompleteMultiplier: 0.65,
        olderMultiplier: 0.8,
    },
    creatorDiversity: {
        windowSize: 12,
        maxPerWindow: 2,
    },
};
function normalizedTags(tags) {
    return [...new Set((tags ?? [])
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean))];
}
function signalRecencyWeight(at, now) {
    const ageDays = Math.max(0, now - at.getTime()) / DAY_MS;
    return Math.exp(-ageDays / exports.RECOMMENDATION_CONFIG.activityDecayDays);
}
function buildInterestProfile(activity, now) {
    const positiveCategories = new Map();
    const negativeCategories = new Map();
    const positiveTags = new Map();
    const negativeTags = new Map();
    const subscriptionChannelIds = new Set(activity.subscriptionChannelIds ?? []);
    const addSignal = (signal, rawWeight, at) => {
        const weight = rawWeight * signalRecencyWeight(at, now);
        if (!weight)
            return;
        const categoryMap = weight > 0 ? positiveCategories : negativeCategories;
        const tagMap = weight > 0 ? positiveTags : negativeTags;
        const magnitude = Math.abs(weight);
        categoryMap.set(signal.category, (categoryMap.get(signal.category) ?? 0) + magnitude);
        const tags = normalizedTags(signal.tags);
        const tagWeight = tags.length ? magnitude / tags.length : 0;
        for (const tag of tags) {
            tagMap.set(tag, (tagMap.get(tag) ?? 0) + tagWeight);
        }
    };
    for (const signal of activity.watchHistory ?? []) {
        const weight = signal.completed
            ? exports.RECOMMENDATION_CONFIG.watch.completed
            : signal.lastPositionSeconds >= 30
                ? exports.RECOMMENDATION_CONFIG.watch.engaged
                : exports.RECOMMENDATION_CONFIG.watch.brief;
        addSignal(signal, weight, signal.updatedAt);
    }
    for (const signal of activity.likes ?? []) {
        addSignal(signal, signal.isDislike ? exports.RECOMMENDATION_CONFIG.dislike : exports.RECOMMENDATION_CONFIG.like, signal.createdAt);
    }
    for (const signal of activity.comments ?? []) {
        addSignal(signal, exports.RECOMMENDATION_CONFIG.comment, signal.createdAt);
    }
    for (const signal of activity.validViews ?? []) {
        addSignal(signal, exports.RECOMMENDATION_CONFIG.validView, signal.createdAt);
    }
    const total = (map) => ([...map.values()].reduce((sum, value) => sum + value, 0));
    return {
        positiveCategories,
        negativeCategories,
        positiveTags,
        negativeTags,
        positiveCategoryTotal: total(positiveCategories),
        negativeCategoryTotal: total(negativeCategories),
        positiveTagTotal: total(positiveTags),
        negativeTagTotal: total(negativeTags),
        positiveConfidence: Math.min(1, total(positiveCategories) / exports.RECOMMENDATION_CONFIG.interestConfidenceSignals),
        negativeConfidence: Math.min(1, total(negativeCategories) / exports.RECOMMENDATION_CONFIG.interestConfidenceSignals),
        subscriptionChannelIds,
    };
}
function watchedMultiplier(history, now) {
    if (!history)
        return 1;
    const ageDays = Math.max(0, now - history.updatedAt.getTime()) / DAY_MS;
    const { watchedSuppression } = exports.RECOMMENDATION_CONFIG;
    if (ageDays <= watchedSuppression.recentDays) {
        return history.completed
            ? watchedSuppression.recentCompletedMultiplier
            : watchedSuppression.recentIncompleteMultiplier;
    }
    if (ageDays <= watchedSuppression.monthDays) {
        return history.completed
            ? watchedSuppression.monthCompletedMultiplier
            : watchedSuppression.monthIncompleteMultiplier;
    }
    return watchedSuppression.olderMultiplier;
}
function candidateRelevance(candidate, profile) {
    const positiveCategory = profile.positiveCategoryTotal
        ? (profile.positiveCategories.get(candidate.category) ?? 0) / profile.positiveCategoryTotal
        : 0;
    const negativeCategory = profile.negativeCategoryTotal
        ? (profile.negativeCategories.get(candidate.category) ?? 0) / profile.negativeCategoryTotal
        : 0;
    const candidateTags = normalizedTags(candidate.tags);
    const positiveTagTotal = profile.positiveTagTotal;
    const negativeTagTotal = profile.negativeTagTotal;
    const positiveTag = positiveTagTotal && candidateTags.length
        ? candidateTags.reduce((sum, tag) => sum + (profile.positiveTags.get(tag) ?? 0) / positiveTagTotal, 0) / candidateTags.length
        : 0;
    const negativeTag = negativeTagTotal && candidateTags.length
        ? candidateTags.reduce((sum, tag) => sum + (profile.negativeTags.get(tag) ?? 0) / negativeTagTotal, 0) / candidateTags.length
        : 0;
    return exports.RECOMMENDATION_CONFIG.categoryRelevance
        * (positiveCategory * profile.positiveConfidence
            - negativeCategory * profile.negativeConfidence * exports.RECOMMENDATION_CONFIG.negativeInterestScale)
        + exports.RECOMMENDATION_CONFIG.tagRelevance
            * (positiveTag * profile.positiveConfidence
                - negativeTag * profile.negativeConfidence * exports.RECOMMENDATION_CONFIG.negativeInterestScale);
}
function diversifyCreatorRanking(candidates) {
    const remaining = [...candidates];
    const result = [];
    const { windowSize, maxPerWindow } = exports.RECOMMENDATION_CONFIG.creatorDiversity;
    const creatorCount = new Set(candidates.map(({ candidate }) => candidate.channelId)).size;
    const effectiveMaxPerWindow = creatorCount
        ? Math.max(maxPerWindow, Math.ceil(windowSize / creatorCount))
        : maxPerWindow;
    while (remaining.length) {
        const recent = result.slice(-(windowSize - 1));
        const recentCounts = new Map();
        for (const item of recent) {
            const channelId = item.candidate.channelId;
            recentCounts.set(channelId, (recentCounts.get(channelId) ?? 0) + 1);
        }
        const nextIndex = remaining.findIndex((item) => ((recentCounts.get(item.candidate.channelId) ?? 0) < effectiveMaxPerWindow));
        result.push(remaining.splice(nextIndex < 0 ? 0 : nextIndex, 1)[0]);
    }
    return result;
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function rankForYouVideos(candidates, activity = {}, now = new Date()) {
    const nowMs = now.getTime();
    const profile = buildInterestProfile(activity, nowMs);
    const seenIds = new Set();
    const uniqueCandidates = candidates.filter((candidate) => {
        if (seenIds.has(candidate.id))
            return false;
        seenIds.add(candidate.id);
        return true;
    });
    const maxViews = uniqueCandidates.reduce((max, candidate) => Math.max(max, candidate.viewsCount), 0);
    const watchedById = new Map();
    for (const history of activity.watchHistory ?? []) {
        const previous = watchedById.get(history.videoId);
        if (!previous || previous.updatedAt < history.updatedAt) {
            watchedById.set(history.videoId, history);
        }
    }
    const scored = uniqueCandidates.map((candidate) => {
        const publishedAt = candidate.publishedAt ?? candidate.createdAt;
        const ageDays = Math.max(0, nowMs - publishedAt.getTime()) / DAY_MS;
        const recency = 1 / (1 + ageDays / exports.RECOMMENDATION_CONFIG.recencyScaleDays);
        const popularity = maxViews > 0
            ? Math.log1p(Math.max(0, candidate.viewsCount)) / Math.log1p(maxViews)
            : 0;
        const relevance = candidateRelevance(candidate, profile);
        const subscriptionBonus = profile.subscriptionChannelIds.has(candidate.channelId)
            ? exports.RECOMMENDATION_CONFIG.subscribedChannelBonus
            : 0;
        const baseScore = relevance
            + subscriptionBonus
            + recency * exports.RECOMMENDATION_CONFIG.recencyWeight
            + popularity * exports.RECOMMENDATION_CONFIG.popularityWeight;
        const repeatMultiplier = watchedMultiplier(watchedById.get(candidate.id), nowMs);
        return {
            candidate,
            relevance,
            recency,
            publishedAt: publishedAt.getTime(),
            score: baseScore >= 0
                ? baseScore * repeatMultiplier
                : baseScore * (2 - repeatMultiplier),
        };
    }).sort((left, right) => (right.score - left.score
        || right.relevance - left.relevance
        || right.recency - left.recency
        || right.publishedAt - left.publishedAt
        || compareText(left.candidate.id, right.candidate.id)));
    return diversifyCreatorRanking(scored).map(({ candidate }) => candidate);
}
function buildRecommendationCandidateQuery() {
    return {
        where: publicContent_1.publicDiscoveryVideoWhere,
        take: exports.RECOMMENDATION_CONFIG.candidateLimit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
            ...publicContent_1.publicVideoSelect,
            channelId: true,
            category: true,
            tags: true,
        },
    };
}
function buildViewerActivityQueries(userId) {
    const eligibleVideo = { is: publicContent_1.publicDiscoveryVideoWhere };
    return {
        watchHistory: {
            where: { userId, video: eligibleVideo },
            take: exports.RECOMMENDATION_CONFIG.activityLimit,
            orderBy: { updatedAt: 'desc' },
            select: {
                videoId: true,
                completed: true,
                lastPositionSeconds: true,
                updatedAt: true,
                video: { select: { category: true, tags: true, channelId: true } },
            },
        },
        likes: {
            where: { userId, video: eligibleVideo },
            take: exports.RECOMMENDATION_CONFIG.activityLimit,
            orderBy: { createdAt: 'desc' },
            select: {
                videoId: true,
                isDislike: true,
                createdAt: true,
                video: { select: { category: true, tags: true, channelId: true } },
            },
        },
        comments: {
            where: { userId, video: eligibleVideo },
            take: exports.RECOMMENDATION_CONFIG.activityLimit,
            orderBy: { createdAt: 'desc' },
            select: {
                createdAt: true,
                video: { select: { category: true, tags: true, channelId: true } },
            },
        },
        validViews: {
            where: { userId, isValidView: true, video: eligibleVideo },
            take: exports.RECOMMENDATION_CONFIG.activityLimit,
            orderBy: { createdAt: 'desc' },
            select: {
                videoId: true,
                createdAt: true,
                video: { select: { category: true, tags: true, channelId: true } },
            },
        },
        subscriptions: {
            where: {
                subscriberId: userId,
                channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
            },
            take: exports.RECOMMENDATION_CONFIG.activityLimit,
            orderBy: { createdAt: 'desc' },
            select: { channelId: true },
        },
    };
}
const databaseRepository = {
    async findCandidates() {
        return database_1.db.video.findMany(buildRecommendationCandidateQuery());
    },
    async findViewerActivity(userId) {
        const queries = buildViewerActivityQueries(userId);
        const [watchHistory, likes, comments, validViews, subscriptions] = await Promise.all([
            database_1.db.watchHistory.findMany(queries.watchHistory),
            database_1.db.videoLike.findMany(queries.likes),
            database_1.db.comment.findMany(queries.comments),
            database_1.db.videoViewEvent.findMany(queries.validViews),
            database_1.db.subscription.findMany(queries.subscriptions),
        ]);
        return {
            watchHistory: watchHistory.map((signal) => ({
                ...signal,
                ...signal.video,
            })),
            likes: likes.map((signal) => ({
                ...signal,
                ...signal.video,
            })),
            comments: comments.map((signal) => ({
                ...signal.video,
                createdAt: signal.createdAt,
            })),
            validViews: validViews.map((signal) => ({
                ...signal,
                ...signal.video,
            })),
            subscriptionChannelIds: subscriptions.map(({ channelId }) => channelId),
        };
    },
};
function createForYouService(repository = databaseRepository, now = () => new Date()) {
    return async ({ userId, page, limit }) => {
        const [candidates, activity] = await Promise.all([
            repository.findCandidates(),
            userId ? repository.findViewerActivity(userId) : Promise.resolve({}),
        ]);
        const ranked = rankForYouVideos(candidates, activity, now());
        const offset = (page - 1) * limit;
        const videos = ranked.slice(offset, offset + limit).map((candidate) => {
            const { category: _category, tags: _tags, channelId: _channelId, ...publicVideo } = candidate;
            return publicVideo;
        });
        return {
            videos,
            pagination: { page, limit, hasMore: offset + videos.length < ranked.length },
            strategy: userId && hasActivity(activity) ? 'personalized' : 'discovery',
        };
    };
}
function hasActivity(activity) {
    return Boolean(activity.watchHistory?.length
        || activity.likes?.length
        || activity.comments?.length
        || activity.validViews?.length
        || activity.subscriptionChannelIds?.length);
}
