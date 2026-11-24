"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createShortsMonetizationAdminRouter = createShortsMonetizationAdminRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const shortsMonetization_1 = require("../services/shortsMonetization");
const updateRateSchema = zod_1.z.object({
    ratePercent: zod_1.z.string(),
});
function serializeRateChange(change) {
    return {
        id: change.id,
        actorId: change.actorId,
        previousRatePercent: (0, shortsMonetization_1.formatRateBasisPoints)(change.previousRateBasisPoints),
        newRatePercent: (0, shortsMonetization_1.formatRateBasisPoints)(change.newRateBasisPoints),
        changedAt: change.changedAt.toISOString(),
    };
}
function serializeSetting(setting) {
    return {
        ratePercent: (0, shortsMonetization_1.formatRateBasisPoints)(setting.rateBasisPoints),
        updatedAt: setting.updatedAt.toISOString(),
        updatedById: setting.updatedById,
    };
}
function createShortsMonetizationAdminRouter(requireAdministratorMiddleware, repository) {
    const router = express_1.default.Router();
    router.use(requireAdministratorMiddleware);
    router.get('/shorts-rate', async (_req, res) => {
        try {
            const [setting, history] = await Promise.all([
                repository.findSetting(),
                repository.listRateChanges(50),
            ]);
            if (!setting) {
                return res.status(503).json({ error: 'Shorts monetization settings are unavailable.' });
            }
            return res.status(200).json({
                ...serializeSetting(setting),
                history: history.map(serializeRateChange),
            });
        }
        catch (error) {
            console.error('Failed to load Shorts monetization settings:', error);
            return res.status(503).json({ error: 'Shorts monetization settings are unavailable.' });
        }
    });
    router.put('/shorts-rate', async (req, res) => {
        const parsedBody = updateRateSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return res.status(400).json({ error: 'Enter a percentage with up to two decimal places.' });
        }
        const rateBasisPoints = (0, shortsMonetization_1.ratePercentToBasisPoints)(parsedBody.data.ratePercent);
        if (rateBasisPoints === null) {
            return res.status(400).json({ error: 'Rate must be between 0.00% and 100.00%.' });
        }
        const actor = req.user;
        if (!actor?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        try {
            const result = await repository.updateRate({ actorId: actor.id, newRateBasisPoints: rateBasisPoints });
            if (!result) {
                return res.status(409).json({ error: 'The rate changed concurrently. Reload and try again.' });
            }
            if (result.change && repository.onRateChanged) {
                await repository.onRateChanged({
                    actorId: actor.id,
                    actorRole: actor.role || 'SUPER_ADMIN',
                    change: result.change,
                    req,
                });
            }
            return res.status(200).json({
                ...serializeSetting(result.setting),
                change: result.change ? serializeRateChange(result.change) : null,
            });
        }
        catch (error) {
            console.error('Failed to update Shorts monetization rate:', error);
            return res.status(503).json({ error: 'Shorts monetization rate could not be saved.' });
        }
    });
    return router;
}
