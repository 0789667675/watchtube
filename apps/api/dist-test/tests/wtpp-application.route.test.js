"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const trust_route_1 = require("../src/routes/trust.route");
const wtppPii_1 = require("../src/security/wtppPii");
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
let activeServers = [];
const previousEncryptionKey = process.env.WTPP_PII_ENCRYPTION_KEY;
async function startServer(repository) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authenticate = (req, res, next) => {
        const userId = req.get('x-test-user');
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        req.user = { id: userId };
        next();
    };
    app.use('/api/v1', (0, trust_route_1.createWtppApplicationRouter)(authenticate, repository));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}
function createRepository() {
    let application = null;
    let submitCount = 0;
    let submittedInput;
    const repository = {
        async findCreatorChannel(userId, channelId) {
            return userId === USER_ID && (!channelId || channelId === CHANNEL_ID)
                ? { id: CHANNEL_ID, name: 'Creator', handle: '@creator', subscriberCount: 0, isMonetized: false }
                : null;
        },
        async findApplication() {
            return application;
        },
        async getChannelWatchHours() {
            return 0;
        },
        async submitApplication(input) {
            if (application && application.status !== 'REJECTED')
                return null;
            submittedInput = input;
            submitCount += 1;
            application = { status: 'PENDING', reviewerNotes: null, reviewedAt: null };
            return application;
        },
    };
    return {
        repository,
        setRejected() {
            application = { status: 'REJECTED', reviewerNotes: 'Correct the issue.', reviewedAt: new Date() };
        },
        getSubmitCount: () => submitCount,
        getSubmittedInput: () => submittedInput,
    };
}
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
    activeServers = [];
    if (previousEncryptionKey === undefined)
        delete process.env.WTPP_PII_ENCRYPTION_KEY;
    else
        process.env.WTPP_PII_ENCRYPTION_KEY = previousEncryptionKey;
});
(0, node_test_1.test)('creators below legacy thresholds may apply and repeat applications after rejection', async () => {
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const headers = { 'content-type': 'application/json', 'x-test-user': USER_ID };
    const statusResponse = await fetch(`${baseUrl}/api/v1/wtpp/status?channelId=${CHANNEL_ID}`, { headers });
    strict_1.default.equal(statusResponse.status, 200);
    strict_1.default.deepEqual(await statusResponse.json(), {
        channelId: CHANNEL_ID,
        channelName: 'Creator',
        channelHandle: '@creator',
        isMonetized: false,
        applicationStatus: 'NOT_APPLIED',
        canApply: true,
        reviewerNotes: null,
        reviewedAt: null,
    });
    const firstApplication = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channelId: CHANNEL_ID }),
    });
    strict_1.default.equal(firstApplication.status, 201);
    strict_1.default.equal((await firstApplication.json()).status, 'PENDING');
    strict_1.default.deepEqual(state.getSubmittedInput(), {
        channelId: CHANNEL_ID,
        channelWatchHours: 0,
        subscriberCount: 0,
    });
    const duplicate = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channelId: CHANNEL_ID }),
    });
    strict_1.default.equal(duplicate.status, 409);
    state.setRejected();
    const reapplication = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ channelId: CHANNEL_ID }),
    });
    strict_1.default.equal(reapplication.status, 201);
    strict_1.default.equal((await reapplication.json()).status, 'PENDING');
    strict_1.default.equal(state.getSubmitCount(), 2);
});
(0, node_test_1.test)('WTPP routes require authentication and only find the signed-in creator channel', async () => {
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const unauthorized = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    strict_1.default.equal(unauthorized.status, 401);
    const missingChannel = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': '33333333-3333-4333-8333-333333333333' },
        body: '{}',
    });
    strict_1.default.equal(missingChannel.status, 404);
    strict_1.default.equal(state.getSubmitCount(), 0);
    const unownedChannel = await fetch(`${baseUrl}/api/v1/wtpp/status?channelId=44444444-4444-4444-8444-444444444444`, {
        headers: { 'x-test-user': USER_ID },
    });
    strict_1.default.equal(unownedChannel.status, 404);
});
(0, node_test_1.test)('WTPP identity fields are encrypted before persistence and omitted from responses', async () => {
    process.env.WTPP_PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const headers = { 'content-type': 'application/json', 'x-test-user': USER_ID };
    const response = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            channelId: CHANNEL_ID,
            taxId: 'private-tax-id',
            nationalIdOrPassport: 'private-identity-document',
        }),
    });
    strict_1.default.equal(response.status, 201);
    strict_1.default.deepEqual(await response.json(), {
        status: 'PENDING',
        reviewerNotes: null,
        reviewedAt: null,
    });
    const stored = state.getSubmittedInput();
    strict_1.default.notEqual(stored.taxId, 'private-tax-id');
    strict_1.default.notEqual(stored.nationalIdOrPassport, 'private-identity-document');
    strict_1.default.equal((0, wtppPii_1.decryptWtppPii)(stored.taxId, 'taxId'), 'private-tax-id');
    strict_1.default.equal((0, wtppPii_1.decryptWtppPii)(stored.nationalIdOrPassport, 'nationalIdOrPassport'), 'private-identity-document');
});
(0, node_test_1.test)('WTPP identity submission fails closed when encryption is not configured', async () => {
    delete process.env.WTPP_PII_ENCRYPTION_KEY;
    const state = createRepository();
    const baseUrl = await startServer(state.repository);
    const response = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': USER_ID },
        body: JSON.stringify({ channelId: CHANNEL_ID, taxId: 'private-tax-id' }),
    });
    strict_1.default.equal(response.status, 503);
    strict_1.default.deepEqual(await response.json(), {
        error: 'Sensitive identity encryption is not configured.',
    });
    strict_1.default.equal(state.getSubmitCount(), 0);
});
