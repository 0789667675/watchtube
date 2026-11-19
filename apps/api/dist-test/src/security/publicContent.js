"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicVideoAccessWhere = publicVideoAccessWhere;
exports.publicVideoWhere = publicVideoWhere;
exports.publicTopLevelCommentsWhere = publicTopLevelCommentsWhere;
exports.publicRepliesWhere = publicRepliesWhere;
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
