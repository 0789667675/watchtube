"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const admin_1 = require("../src/middleware/admin");
const wtpp_review_route_1 = require("../src/routes/wtpp-review.route");
const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
let activeServers = [];
function createRepository() {
    let status = 'PENDING';
    let reviewerNotes = null;
    const reviewedAt = null;
    const repository = {
        async reviewPendingApplication(input) {
            if (status !== 'PENDING')
                return null;
            status = input.status;
            reviewerNotes = input.reviewerNotes;
            return Object.assign({ id: input.applicationId, status, reviewerNotes, reviewedAt }, { taxId: 'private-tax-id', nationalIdOrPassport: 'private-identity-document' });
        },
    };
    return { repository, getStatus: () => status };
}
async function startServer(repository) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const testIdentity = (req, res, next) => {
        const role = req.get('x-test-role');
        if (!role)
            return res.status(401).json({ error: 'Unauthorized' });
        req.user = {
            id: '22222222-2222-4222-8222-222222222222',
            role,
        };
        next();
    };
    app.use('/admin', testIdentity, admin_1.requireAdmin, (0, wtpp_review_route_1.createWtppReviewRouter)(repository));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
    activeServers = [];
});
(0, node_test_1.test)('only administrators and moderators may review a pending application', async () => {
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const path = `${baseUrl}/admin/${APPLICATION_ID}`;
    const unauthorized = await fetch(path, { method: 'PATCH' });
    strict_1.default.equal(unauthorized.status, 401);
    const viewer = await fetch(path, {
        method: 'PATCH',
        headers: { 'x-test-role': 'VIEWER', 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED' }),
    });
    strict_1.default.equal(viewer.status, 403);
    strict_1.default.equal(state.getStatus(), 'PENDING');
    const moderator = await fetch(path, {
        method: 'PATCH',
        headers: { 'x-test-role': 'MODERATOR', 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED' }),
    });
    strict_1.default.equal(moderator.status, 200);
    strict_1.default.equal((await moderator.json()).status, 'APPROVED');
});
(0, node_test_1.test)('rejection requires a reason and only pending applications can be reviewed', async () => {
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const path = `${baseUrl}/admin/${APPLICATION_ID}`;
    const headers = { 'x-test-role': 'ADMIN', 'content-type': 'application/json' };
    const missingReason = await fetch(path, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'REJECTED' }),
    });
    strict_1.default.equal(missingReason.status, 400);
    strict_1.default.equal(state.getStatus(), 'PENDING');
    const rejected = await fetch(path, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'REJECTED', reviewerNotes: 'Please verify channel ownership.' }),
    });
    strict_1.default.equal(rejected.status, 200);
    strict_1.default.deepEqual(await rejected.json(), {
        id: APPLICATION_ID,
        status: 'REJECTED',
        reviewerNotes: 'Please verify channel ownership.',
        reviewedAt: null,
    });
    const repeatedReview = await fetch(path, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'APPROVED' }),
    });
    strict_1.default.equal(repeatedReview.status, 409);
});
