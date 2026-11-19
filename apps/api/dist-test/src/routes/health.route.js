"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthRouter = createHealthRouter;
const express_1 = require("express");
function createHealthRouter(dependencies) {
    const router = (0, express_1.Router)();
    router.get('/health', (_req, res) => {
        res.status(200).json({ status: 'ok' });
    });
    router.get('/ready', async (_req, res) => {
        let databaseStatus = 'unconfigured';
        if (dependencies.databaseConfigured) {
            try {
                await dependencies.checkDatabase();
                databaseStatus = 'connected';
            }
            catch {
                databaseStatus = 'unavailable';
            }
        }
        const storage = dependencies.getStorageStatus();
        const redisStatus = dependencies.getRedisStatus();
        const ready = databaseStatus === 'connected';
        res.status(ready ? 200 : 503).json({
            status: ready
                ? redisStatus === 'connected' && storage.status === 'configured'
                    ? 'ready'
                    : 'degraded'
                : 'degraded',
            services: {
                database: databaseStatus,
                redis: redisStatus,
                storage,
            },
        });
    });
    return router;
}
