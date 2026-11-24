"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trustRouter = void 0;
exports.createWtppApplicationRouter = createWtppApplicationRouter;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const database_1 = require("@watchtube/database");
const auth_1 = require("../middleware/auth");
const databaseErrors_1 = require("../config/databaseErrors");
const wtppPii_1 = require("../security/wtppPii");
const notifications_1 = require("../services/notifications");
const trustRouter = express_1.default.Router();
exports.trustRouter = trustRouter;
function createWtppApplicationRouter(authenticate, repository) {
    const router = express_1.default.Router();
    router.get('/wtpp/status', authenticate, async (req, res) => {
        const query = zod_1.z.object({ channelId: zod_1.z.string().uuid().optional() }).strict().safeParse(req.query);
        if (!query.success)
            return res.status(400).json({ error: 'Invalid channel ID' });
        try {
            const channel = await repository.findCreatorChannel(req.user.id, query.data.channelId);
            if (!channel)
                return res.status(404).json({ error: 'Channel not found' });
            const application = await repository.findApplication(channel.id);
            const applicationStatus = application?.status ?? 'NOT_APPLIED';
            const canApply = !channel.isMonetized
                && (applicationStatus === 'NOT_APPLIED' || applicationStatus === 'REJECTED');
            res.status(200).json({
                channelId: channel.id,
                channelName: channel.name,
                channelHandle: channel.handle,
                isMonetized: channel.isMonetized,
                applicationStatus,
                canApply,
                reviewerNotes: application?.reviewerNotes ?? null,
                reviewedAt: application?.reviewedAt?.toISOString() ?? null,
            });
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Creator program status is temporarily unavailable because the database is unavailable.');
        }
    });
    router.post('/wtpp/apply', authenticate, async (req, res) => {
        const applySchema = zod_1.z.object({
            channelId: zod_1.z.string().uuid().optional(),
            taxId: zod_1.z.string().max(256).optional(),
            nationalIdOrPassport: zod_1.z.string().max(256).optional(),
        }).strict();
        const parsed = applySchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }
        try {
            const { channelId, taxId, nationalIdOrPassport } = parsed.data;
            const applicationDetails = {
                ...(taxId === undefined ? {} : { taxId: (0, wtppPii_1.encryptWtppPii)(taxId, 'taxId') }),
                ...(nationalIdOrPassport === undefined
                    ? {}
                    : { nationalIdOrPassport: (0, wtppPii_1.encryptWtppPii)(nationalIdOrPassport, 'nationalIdOrPassport') }),
            };
            const channel = await repository.findCreatorChannel(req.user.id, channelId);
            if (!channel)
                return res.status(404).json({ error: 'Channel not found' });
            const channelWatchHours = await repository.getChannelWatchHours(channel.id);
            const application = await repository.submitApplication({
                channelId: channel.id,
                channelWatchHours,
                subscriberCount: channel.subscriberCount,
                ...applicationDetails,
            });
            if (!application) {
                return res.status(409).json({ error: 'Application already in progress or approved' });
            }
            void (0, notifications_1.emitPlatformEvent)({
                eventId: node_crypto_1.default.randomUUID(),
                eventType: 'WTPP_APPLICATION_RECEIVED',
                userId: req.user.id,
                channelId: channel.id,
                channelName: channel.name,
                applicationId: application.id || channel.id,
                timestamp: new Date(),
            });
            res.status(201).json(application);
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
                res.status(409).json({ error: 'Application already in progress or approved' });
                return;
            }
            if (error instanceof wtppPii_1.WtppPiiConfigurationError) {
                res.status(503).json({ error: 'Sensitive identity encryption is not configured.' });
                return;
            }
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Creator program application is temporarily unavailable because the database is unavailable.');
        }
    });
    return router;
}
const reportSchema = zod_1.z.object({
    targetType: zod_1.z.enum(['VIDEO', 'COMMENT', 'CHANNEL']),
    targetId: zod_1.z.string().uuid(),
    reason: zod_1.z.enum(['SPAM', 'HARASSMENT', 'COPYRIGHT', 'HATE_SPEECH', 'MISLEADING', 'OTHER']),
    details: zod_1.z.string().optional()
});
trustRouter.post('/reports', auth_1.authenticate, async (req, res) => {
    try {
        const reporterId = req.user.id;
        const { targetType, targetId, reason, details } = reportSchema.parse(req.body);
        const report = await database_1.db.report.create({
            data: { reporterId, targetType, targetId, reason, details, status: 'OPEN' }
        });
        res.status(201).json(report);
    }
    catch (error) {
        if (!(error instanceof zod_1.z.ZodError)) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Report submission is temporarily unavailable because the database is unavailable.');
            return;
        }
        res.status(400).json({ error: 'Invalid request' });
    }
});
const copyrightSchema = zod_1.z.object({
    videoId: zod_1.z.string().uuid(),
    description: zod_1.z.string().min(10),
    proofUrl: zod_1.z.string().url().optional()
});
trustRouter.post('/copyright/claims', auth_1.authenticate, async (req, res) => {
    try {
        const claimantId = req.user.id;
        const { videoId, description, proofUrl } = copyrightSchema.parse(req.body);
        const claim = await database_1.db.copyrightClaim.create({
            data: { claimantId, videoId, description, proofUrl, status: 'OPEN' }
        });
        res.status(201).json(claim);
    }
    catch (error) {
        if (!(error instanceof zod_1.z.ZodError)) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Copyright claim submission is temporarily unavailable because the database is unavailable.');
            return;
        }
        res.status(400).json({ error: 'Invalid request' });
    }
});
trustRouter.use(createWtppApplicationRouter(auth_1.authenticate, {
    async findCreatorChannel(userId, channelId) {
        return database_1.db.channel.findFirst({
            where: { userId, ...(channelId ? { id: channelId } : {}) },
            select: { id: true, name: true, handle: true, subscriberCount: true, isMonetized: true },
            orderBy: { createdAt: 'asc' },
        });
    },
    async findApplication(channelId) {
        return database_1.db.wtppApplication.findUnique({
            where: { channelId },
            select: { status: true, reviewerNotes: true, reviewedAt: true },
        });
    },
    async getChannelWatchHours(channelId) {
        const aggregate = await database_1.db.videoViewEvent.aggregate({
            where: { video: { channelId }, isValidView: true },
            _sum: { watchDurationSeconds: true },
        });
        return (aggregate._sum.watchDurationSeconds ?? 0) / 3600;
    },
    async submitApplication(input) {
        return database_1.db.$transaction(async (transaction) => {
            const existing = await transaction.wtppApplication.findUnique({
                where: { channelId: input.channelId },
                select: { id: true, status: true },
            });
            const applicationData = {
                status: 'PENDING',
                channelWatchHours: input.channelWatchHours,
                subscriberCount: input.subscriberCount,
                taxId: input.taxId,
                nationalIdOrPassport: input.nationalIdOrPassport,
                reviewerNotes: null,
                reviewedAt: null,
                submittedAt: new Date(),
            };
            if (!existing) {
                return transaction.wtppApplication.create({
                    data: { ...applicationData, channelId: input.channelId },
                    select: { status: true, reviewerNotes: true, reviewedAt: true },
                });
            }
            if (existing.status !== 'REJECTED')
                return null;
            const updated = await transaction.wtppApplication.updateMany({
                where: { id: existing.id, status: 'REJECTED' },
                data: applicationData,
            });
            if (updated.count !== 1)
                return null;
            return transaction.wtppApplication.findUnique({
                where: { id: existing.id },
                select: { status: true, reviewerNotes: true, reviewedAt: true },
            });
        });
    },
}));
