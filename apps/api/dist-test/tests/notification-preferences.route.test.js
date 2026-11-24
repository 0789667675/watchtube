"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const notifications_route_1 = require("../src/routes/notifications.route");
const notifications_1 = require("../src/services/notifications");
let activeServers = [];
(0, node_test_1.afterEach)(async () => {
    await Promise.all(activeServers.map((server) => new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    })));
    activeServers = [];
});
async function startPreferencesServer(notificationService) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const authenticate = (req, res, next) => {
        const authHeader = req.get('x-test-user');
        if (!authHeader) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        req.user = { id: authHeader, role: 'USER' };
        next();
    };
    app.use('/notifications', (0, notifications_route_1.createNotificationRouter)({ authenticate, notificationService }));
    const server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    activeServers.push(server);
    const address = server.address();
    return `http://127.0.0.1:${address.port}/notifications/preferences`;
}
(0, node_test_1.test)('Notification Preferences API: authentication required for GET and PATCH', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
    const url = await startPreferencesServer(service);
    const getRes = await fetch(url);
    strict_1.default.equal(getRes.status, 401);
    const patchRes = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emailVideoProcessing: false }),
    });
    strict_1.default.equal(patchRes.status, 401);
});
(0, node_test_1.test)('Notification Preferences API: returns safe defaults on first fetch', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
    const url = await startPreferencesServer(service);
    const res = await fetch(url, {
        headers: { 'x-test-user': 'user-new-pref' },
    });
    strict_1.default.equal(res.status, 200);
    const body = await res.json();
    strict_1.default.equal(body.userId, 'user-new-pref');
    strict_1.default.equal(body.emailSecurityAlerts, true);
    strict_1.default.equal(body.emailFinancialTransfers, true);
    strict_1.default.equal(body.emailWtppUpdates, true);
    strict_1.default.equal(body.emailVideoProcessing, true);
    strict_1.default.equal(body.emailPlatformAnnouncements, true);
    strict_1.default.equal(body.inAppFinancialAlerts, true);
    strict_1.default.equal(body.inAppVideoProcessing, true);
    strict_1.default.equal(body.inAppPlatformAnnouncements, true);
});
(0, node_test_1.test)('Notification Preferences API: updates preferences and strictly prevents disabling security alerts', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
    const url = await startPreferencesServer(service);
    // User attempts to disable email security alerts along with other preferences
    const patchRes = await fetch(url, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            'x-test-user': 'user-strict-security',
        },
        body: JSON.stringify({
            emailSecurityAlerts: false, // Attempt to disable mandatory security alerts
            emailVideoProcessing: false,
            inAppPlatformAnnouncements: false,
        }),
    });
    strict_1.default.equal(patchRes.status, 200);
    const patched = await patchRes.json();
    // Mandatory security alerts MUST remain true
    strict_1.default.equal(patched.emailSecurityAlerts, true);
    // Requested toggles must be honored
    strict_1.default.equal(patched.emailVideoProcessing, false);
    strict_1.default.equal(patched.inAppPlatformAnnouncements, false);
    // Unspecified toggles should remain at default (true)
    strict_1.default.equal(patched.emailFinancialTransfers, true);
    // Verify subsequent GET also reflects persistent state
    const getRes = await fetch(url, {
        headers: { 'x-test-user': 'user-strict-security' },
    });
    const refreshed = await getRes.json();
    strict_1.default.equal(refreshed.emailSecurityAlerts, true);
    strict_1.default.equal(refreshed.emailVideoProcessing, false);
    strict_1.default.equal(refreshed.inAppPlatformAnnouncements, false);
});
(0, node_test_1.test)('Notification Preferences API: input validation rejects unknown attributes', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
    const url = await startPreferencesServer(service);
    const patchRes = await fetch(url, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            'x-test-user': 'user-pref-validation',
        },
        body: JSON.stringify({
            invalidKey: 'malicious-data',
        }),
    });
    strict_1.default.equal(patchRes.status, 400);
    const body = await patchRes.json();
    strict_1.default.match(body.error, /invalid preferences payload/i);
});
(0, node_test_1.test)('Notification Preferences API: strict isolation between distinct users', async () => {
    const repo = new notifications_1.InMemoryNotificationRepository();
    const service = new notifications_1.NotificationService(repo);
    const url = await startPreferencesServer(service);
    // User A updates preferences
    await fetch(url, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            'x-test-user': 'user-alice',
        },
        body: JSON.stringify({ emailVideoProcessing: false }),
    });
    // User B reads preferences
    const bRes = await fetch(url, {
        headers: { 'x-test-user': 'user-bob' },
    });
    const bData = await bRes.json();
    // User B still has defaults (not affected by User A)
    strict_1.default.equal(bData.userId, 'user-bob');
    strict_1.default.equal(bData.emailVideoProcessing, true);
    // User A has updated value
    const aRes = await fetch(url, {
        headers: { 'x-test-user': 'user-alice' },
    });
    const aData = await aRes.json();
    strict_1.default.equal(aData.userId, 'user-alice');
    strict_1.default.equal(aData.emailVideoProcessing, false);
});
