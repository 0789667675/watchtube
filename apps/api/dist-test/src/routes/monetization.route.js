"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.monetizationRouter = void 0;
exports.createAdEventRouter = createAdEventRouter;
exports.createAdConfigRouter = createAdConfigRouter;
exports.createRevenueReconciliationRouter = createRevenueReconciliationRouter;
const express_1 = __importStar(require("express"));
const database_1 = require("@watchtube/database");
const auth_1 = require("../middleware/auth");
const admin_1 = require("../middleware/admin");
function createAdEventRouter(authenticateMiddleware) {
    const router = (0, express_1.Router)();
    router.post('/ad-event', authenticateMiddleware, (_req, res) => {
        res.status(501).json({ error: 'Ad event verification is not configured' });
    });
    return router;
}
function createAdConfigRouter(loadProviders) {
    const router = (0, express_1.Router)();
    router.get('/config', async (_req, res) => {
        try {
            const providers = await loadProviders();
            res.status(200).json({
                enabled: providers.length > 0,
                providers,
                adSkipOffsetSeconds: 5
            });
        }
        catch (error) {
            console.error('Failed to load monetization config:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
function createRevenueReconciliationRouter(authenticateMiddleware, requireAdminMiddleware) {
    const router = (0, express_1.Router)();
    router.post('/reconcile', authenticateMiddleware, requireAdminMiddleware, (_req, res) => {
        res.status(501).json({ error: 'Revenue reconciliation is unavailable until verified allocation is configured' });
    });
    return router;
}
const monetizationRouter = express_1.default.Router();
exports.monetizationRouter = monetizationRouter;
monetizationRouter.use(createAdEventRouter(auth_1.authenticate));
monetizationRouter.use(createAdConfigRouter(() => database_1.db.adProviderConfig.findMany({
    where: { isEnabled: true },
    orderBy: { priority: 'asc' }
})));
monetizationRouter.use(createRevenueReconciliationRouter(auth_1.authenticate, admin_1.requireAdmin));
