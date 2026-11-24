"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const channel_route_1 = require("../src/routes/channel.route");
let activeServers = [];
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
    activeServers = [];
});
async function startServer(repo, userId = '11111111-1111-4111-8111-111111111111') {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authenticate = (req, _res, next) => {
        req.user = { id: userId, role: 'USER' };
        next();
    };
    const defaultRepo = {
        async createChannel(input) {
            return {
                id: '22222222-2222-4222-8222-222222222222',
                name: input.name,
                handle: input.handle,
                description: input.description ?? null,
                avatarUrl: null,
                bannerUrl: null,
            };
        },
        async findPublicChannel() { return null; },
        async findOwnedChannel() { return null; },
        async handleExists() { return false; },
        async updateOwnedChannel() { return null; },
        ...repo,
    };
    app.use('/channels', (0, channel_route_1.createChannelRouter)({ authenticate, repository: defaultRepo }));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}/channels`;
}
(0, node_test_1.test)('Channel uniqueness: successfully creates first channel for user with unique handle', async () => {
    const url = await startServer({
        hasUserChannel: async () => false,
        handleExists: async () => false,
    });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'First Channel', handle: '@first_chan' }),
    });
    strict_1.default.equal(res.status, 201);
    const data = await res.json();
    strict_1.default.equal(data.name, 'First Channel');
    strict_1.default.equal(data.handle, '@first_chan');
});
(0, node_test_1.test)('Channel uniqueness: rejects creation with 409 when user already owns a channel', async () => {
    const url = await startServer({
        hasUserChannel: async () => true,
        handleExists: async () => false,
    });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Second Channel Attempt', handle: '@second_chan' }),
    });
    strict_1.default.equal(res.status, 409);
    const data = await res.json();
    strict_1.default.equal(data.error, 'Each account may only have one channel.');
});
(0, node_test_1.test)('Channel uniqueness: handles race-condition P2002 on userId with 409 account channel error', async () => {
    const p2002Error = new Error('Unique constraint failed on the fields: (`userId`)');
    p2002Error.code = 'P2002';
    p2002Error.meta = { target: ['userId'] };
    const url = await startServer({
        hasUserChannel: async () => false,
        handleExists: async () => false,
        createChannel: async () => { throw p2002Error; },
    });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Race Channel', handle: '@race_chan' }),
    });
    strict_1.default.equal(res.status, 409);
    const data = await res.json();
    strict_1.default.equal(data.error, 'Each account may only have one channel.');
});
(0, node_test_1.test)('Channel uniqueness: handles duplicate handle with 409 handle already in use', async () => {
    const url = await startServer({
        hasUserChannel: async () => false,
        handleExists: async () => true,
    });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Dup Handle', handle: '@taken_handle' }),
    });
    strict_1.default.equal(res.status, 409);
    const data = await res.json();
    strict_1.default.equal(data.error, 'Handle already in use.');
});
