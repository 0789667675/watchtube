"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotificationRouter = createNotificationRouter;
const express_1 = require("express");
const zod_1 = require("zod");
const databaseErrors_1 = require("../config/databaseErrors");
function getUserId(req, res) {
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return undefined;
    }
    return userId;
}
const listQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional(),
    offset: zod_1.z.coerce.number().int().min(0).optional(),
    unreadOnly: zod_1.z.enum(['true', 'false', '1', '0']).optional().transform((v) => v === 'true' || v === '1'),
});
const updatePreferencesSchema = zod_1.z.object({
    emailSecurityAlerts: zod_1.z.boolean().optional(),
    emailFinancialTransfers: zod_1.z.boolean().optional(),
    emailWtppUpdates: zod_1.z.boolean().optional(),
    emailVideoProcessing: zod_1.z.boolean().optional(),
    emailPlatformAnnouncements: zod_1.z.boolean().optional(),
    inAppFinancialAlerts: zod_1.z.boolean().optional(),
    inAppVideoProcessing: zod_1.z.boolean().optional(),
    inAppPlatformAnnouncements: zod_1.z.boolean().optional(),
}).strict();
function createNotificationRouter(dependencies) {
    const router = (0, express_1.Router)();
    const { authenticate, notificationService } = dependencies;
    router.use(authenticate);
    router.get('/', async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const parsed = listQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.issues });
            return;
        }
        try {
            const result = await notificationService.listNotifications(userId, parsed.data);
            res.status(200).json(result);
        }
        catch (err) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, err, 'Notification service temporarily unavailable.');
        }
    });
    router.get('/preferences', async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        try {
            const preferences = await notificationService.getPreferences(userId);
            res.status(200).json(preferences);
        }
        catch (err) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, err, 'Notification preferences temporarily unavailable.');
        }
    });
    router.patch('/preferences', async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const parsed = updatePreferencesSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid preferences payload', details: parsed.error.issues });
            return;
        }
        try {
            // Security alert preferences can NEVER be disabled by the user or creator
            const sanitized = {
                ...parsed.data,
                emailSecurityAlerts: true,
            };
            const preferences = await notificationService.updatePreferences(userId, sanitized);
            res.status(200).json(preferences);
        }
        catch (err) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, err, 'Could not update notification preferences.');
        }
    });
    router.get('/unread-count', async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        try {
            const unreadCount = await notificationService.getUnreadCount(userId);
            res.status(200).json({ unreadCount });
        }
        catch (err) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, err, 'Notification count temporarily unavailable.');
        }
    });
    router.patch('/:id/read', async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        const id = req.params.id;
        if (!id || typeof id !== 'string') {
            res.status(400).json({ error: 'Invalid notification ID' });
            return;
        }
        try {
            const updated = await notificationService.markAsRead(userId, id);
            if (!updated) {
                res.status(404).json({ error: 'Notification not found' });
                return;
            }
            res.status(200).json(updated);
        }
        catch (err) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, err, 'Could not update notification.');
        }
    });
    router.post('/read-all', async (req, res) => {
        const userId = getUserId(req, res);
        if (!userId)
            return;
        try {
            const result = await notificationService.markAllAsRead(userId);
            res.status(200).json(result);
        }
        catch (err) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, err, 'Could not mark notifications as read.');
        }
    });
    return router;
}
