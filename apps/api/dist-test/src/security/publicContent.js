"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicVideoSelect = exports.publicDiscoveryVideoWhere = void 0;
exports.publicVideoAccessWhere = publicVideoAccessWhere;
exports.publicVideoWhere = publicVideoWhere;
exports.publicTopLevelCommentsWhere = publicTopLevelCommentsWhere;
exports.publicRepliesWhere = publicRepliesWhere;
exports.publicDiscoveryVideoWhere = {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
    isShort: false,
    copyrightReviewStatus: { not: 'BLOCKED' },
    channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
};
exports.publicVideoSelect = {
    id: true,
    isShort: true,
    title: true,
    description: true,
    thumbnailUrl: true,
    duration: true,
    viewsCount: true,
    createdAt: true,
    publishedAt: true,
    channel: {
        select: { name: true, handle: true, avatarUrl: true, isVerified: true },
    },
};
function publicVideoAccessWhere() {
    return {
        status: { in: ['READY', 'PUBLISHED'] },
        visibility: { in: ['PUBLIC', 'UNLISTED'] },
    };
}
function publicVideoWhere(videoId) {
    return {
        id: videoId,
        ...publicVideoAccessWhere(),
    };
}
function publicTopLevelCommentsWhere(videoId) {
    return {
        videoId,
        parentId: null,
        video: { is: publicVideoAccessWhere() },
    };
}
function publicRepliesWhere(parentId) {
    const videoAccess = publicVideoAccessWhere();
    return {
        parentId,
        video: { is: videoAccess },
        parent: { is: { video: { is: videoAccess } } },
    };
}
