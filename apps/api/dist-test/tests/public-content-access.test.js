"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const publicContent_1 = require("../src/security/publicContent");
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';
const PUBLIC_VIDEO = {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: { in: ['PUBLIC', 'UNLISTED'] },
};
(0, node_test_1.test)('public video lookup excludes private and non-ready videos', () => {
    strict_1.default.deepEqual((0, publicContent_1.publicVideoWhere)(VIDEO_ID), {
        id: VIDEO_ID,
        ...PUBLIC_VIDEO,
    });
});
(0, node_test_1.test)('public top-level comments require a ready public or unlisted video', () => {
    strict_1.default.deepEqual((0, publicContent_1.publicTopLevelCommentsWhere)(VIDEO_ID), {
        videoId: VIDEO_ID,
        parentId: null,
        video: { is: PUBLIC_VIDEO },
    });
});
(0, node_test_1.test)('public replies require both the reply and parent videos to be accessible', () => {
    strict_1.default.deepEqual((0, publicContent_1.publicRepliesWhere)(COMMENT_ID), {
        parentId: COMMENT_ID,
        video: { is: PUBLIC_VIDEO },
        parent: { is: { video: { is: PUBLIC_VIDEO } } },
    });
});
