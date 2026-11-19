"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const creator_comments_route_1 = require("../src/routes/creator-comments.route");
const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const COMMENT_ONE_ID = '55555555-5555-4555-8555-555555555555';
const COMMENT_TWO_ID = '66666666-6666-4666-8666-666666666666';
const VIDEO_ID = '77777777-7777-4777-8777-777777777777';
const FOREIGN_COMMENT_ID = '99999999-9999-4999-8999-999999999999';
let activeServers = [];
function createComment(id, content) {
    return {
        id,
        content,
        parentId: null,
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
        user: {
            id: OTHER_USER_ID,
            channels: [{ name: 'Author channel', handle: '@author', avatarUrl: null }],
        },
        video: { id: VIDEO_ID, title: 'Video title' },
    };
}
async function createHarness() {
    const comments = [
        createComment(COMMENT_ONE_ID, 'A useful moderation example'),
        createComment(COMMENT_TWO_ID, 'Another moderation example'),
        createComment('88888888-8888-4888-8888-888888888888', 'Unrelated comment'),
    ];
    const calls = {
        ownership: [],
        lists: [],
        deletions: [],
        ownsChannel: true,
    };
    const authenticate = (req, res, next) => {
        const userId = req.get('x-test-user');
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = { id: userId, role: 'USER' };
        next();
    };
    const repository = {
        ownsChannel: async (channelId, userId) => {
            calls.ownership.push({ channelId, userId });
            return calls.ownsChannel && channelId === CHANNEL_ID && userId === USER_ID;
        },
        listComments: async (input) => {
            calls.lists.push(input);
            const matching = comments.filter((comment) => !input.search
                || comment.content.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())
                || comment.video.title.toLocaleLowerCase().includes(input.search.toLocaleLowerCase()));
            const start = (input.page - 1) * input.limit;
            return { comments: matching.slice(start, start + input.limit), total: matching.length };
        },
        deleteComment: async (input) => {
            calls.deletions.push(input);
            if (input.channelId !== CHANNEL_ID
                || input.userId !== USER_ID
                || input.commentId === FOREIGN_COMMENT_ID)
                return false;
            const index = comments.findIndex((comment) => comment.id === input.commentId);
            if (index < 0)
                return false;
            comments.splice(index, 1);
            return true;
        },
    };
    const app = (0, express_1.default)();
    app.use('/api/v1/studio', (0, creator_comments_route_1.createCreatorCommentsRouter)({ authenticate, repository }));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return { baseUrl: `http://127.0.0.1:${address.port}`, server, comments, calls };
}
async function get(baseUrl, path, userId = USER_ID) {
    return fetch(`${baseUrl}/api/v1/studio${path}`, {
        headers: userId ? { 'x-test-user': userId } : {},
    });
}
async function remove(baseUrl, path, userId = USER_ID) {
    return fetch(`${baseUrl}/api/v1/studio${path}`, {
        method: 'DELETE',
        headers: userId ? { 'x-test-user': userId } : {},
    });
}
(0, node_test_1.beforeEach)(() => {
    activeServers = [];
});
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
});
(0, node_test_1.test)('an authenticated channel owner can list comments with author, video, and date data', async () => {
    const harness = await createHarness();
    const response = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments`);
    const body = await response.json();
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(body.comments.length, 3);
    strict_1.default.equal(body.comments[0].user.channels[0].name, 'Author channel');
    strict_1.default.equal(body.comments[0].video.title, 'Video title');
    strict_1.default.equal(body.comments[0].createdAt, '2026-01-02T03:04:05.000Z');
    strict_1.default.equal(body.page, 1);
    strict_1.default.equal(body.limit, 20);
    strict_1.default.equal(body.total, 3);
    strict_1.default.equal(body.totalPages, 1);
    strict_1.default.deepEqual(harness.calls.ownership, [{ channelId: CHANNEL_ID, userId: USER_ID }]);
    strict_1.default.equal(harness.calls.lists[0].userId, USER_ID);
});
(0, node_test_1.test)('comment listing rejects unauthenticated users and channel non-owners', async () => {
    const harness = await createHarness();
    const anonymous = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments`, '');
    strict_1.default.equal(anonymous.status, 401);
    strict_1.default.equal(harness.calls.ownership.length, 0);
    const nonOwner = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments`, OTHER_USER_ID);
    strict_1.default.equal(nonOwner.status, 404);
    strict_1.default.equal(harness.calls.lists.length, 0);
    harness.calls.ownsChannel = false;
    const otherChannel = await get(harness.baseUrl, `/channels/${OTHER_CHANNEL_ID}/comments`);
    strict_1.default.equal(otherChannel.status, 404);
    strict_1.default.equal(harness.calls.lists.length, 0);
});
(0, node_test_1.test)('listing validates and forwards pagination and search filters', async () => {
    const harness = await createHarness();
    const response = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments?page=2&limit=1&search=moderation`);
    const body = await response.json();
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(body.comments.length, 1);
    strict_1.default.equal(body.comments[0].id, COMMENT_TWO_ID);
    strict_1.default.equal(body.page, 2);
    strict_1.default.equal(body.limit, 1);
    strict_1.default.equal(body.total, 2);
    strict_1.default.equal(body.totalPages, 2);
    strict_1.default.deepEqual(harness.calls.lists[0], {
        channelId: CHANNEL_ID,
        userId: USER_ID,
        page: 2,
        limit: 1,
        search: 'moderation',
    });
    const invalidPage = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments?page=0`);
    strict_1.default.equal(invalidPage.status, 400);
});
(0, node_test_1.test)('an empty comment result reports zero pages', async () => {
    const harness = await createHarness();
    const response = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments?search=no-matching-comments`);
    const body = await response.json();
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(body.comments, []);
    strict_1.default.equal(body.total, 0);
    strict_1.default.equal(body.totalPages, 0);
});
(0, node_test_1.test)('an owner can permanently delete a comment only within the owned channel', async () => {
    const harness = await createHarness();
    const response = await remove(harness.baseUrl, `/channels/${CHANNEL_ID}/comments/${COMMENT_ONE_ID}`);
    const body = await response.json();
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(body, { deleted: true, commentId: COMMENT_ONE_ID });
    strict_1.default.equal(harness.comments.some((comment) => comment.id === COMMENT_ONE_ID), false);
    strict_1.default.deepEqual(harness.calls.deletions, [{
            channelId: CHANNEL_ID,
            commentId: COMMENT_ONE_ID,
            userId: USER_ID,
        }]);
    const nonOwner = await remove(harness.baseUrl, `/channels/${CHANNEL_ID}/comments/${COMMENT_TWO_ID}`, OTHER_USER_ID);
    strict_1.default.equal(nonOwner.status, 404);
    strict_1.default.equal(harness.comments.some((comment) => comment.id === COMMENT_TWO_ID), true);
});
(0, node_test_1.test)('deletion validates IDs and cannot remove a comment belonging to another channel', async () => {
    const harness = await createHarness();
    const invalidId = await remove(harness.baseUrl, `/channels/${CHANNEL_ID}/comments/not-a-uuid`);
    strict_1.default.equal(invalidId.status, 400);
    strict_1.default.equal(harness.calls.deletions.length, 0);
    const foreignComment = await remove(harness.baseUrl, `/channels/${CHANNEL_ID}/comments/${FOREIGN_COMMENT_ID}`);
    strict_1.default.equal(foreignComment.status, 404);
    strict_1.default.equal(harness.calls.deletions.length, 1);
});
