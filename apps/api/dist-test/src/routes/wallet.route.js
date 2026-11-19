"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletRouter = void 0;
exports.createPayoutRouter = createPayoutRouter;
const express_1 = __importDefault(require("express"));
const database_1 = require("@watchtube/database");
const auth_1 = require("../middleware/auth");
const databaseErrors_1 = require("../config/databaseErrors");
const walletRouter = express_1.default.Router();
exports.walletRouter = walletRouter;
function createPayoutRouter(authenticateMiddleware) {
    const router = express_1.default.Router();
    router.post('/', authenticateMiddleware, (_req, res) => {
        res.status(501).json({
            error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
        });
    });
    return router;
}
walletRouter.get('/balance', auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const channel = await database_1.db.channel.findFirst({ where: { userId } });
        if (!channel)
            return res.status(404).json({ error: 'Channel not found' });
        const lastTx = await database_1.db.walletTransaction.findFirst({
            where: { channelId: channel.id },
            orderBy: { createdAt: 'desc' }
        });
        const balanceCents = lastTx ? lastTx.balanceAfterCents.toString() : '0';
        res.status(200).json({ balanceCents, currency: 'RWF' });
    }
    catch (error) {
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Wallet balance is temporarily unavailable because the database is unavailable.');
    }
});
walletRouter.get('/ledger', auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const channel = await database_1.db.channel.findFirst({ where: { userId } });
        if (!channel)
            return res.status(404).json({ error: 'Channel not found' });
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const ledger = await database_1.db.walletTransaction.findMany({
            where: { channelId: channel.id },
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' }
        });
        // BigInt serialization fix
        const serializedLedger = ledger.map(tx => ({
            ...tx,
            amountCents: tx.amountCents.toString(),
            balanceAfterCents: tx.balanceAfterCents.toString(),
        }));
        res.status(200).json(serializedLedger);
    }
    catch (error) {
        (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Wallet history is temporarily unavailable because the database is unavailable.');
    }
});
walletRouter.use('/request-payout', createPayoutRouter(auth_1.authenticate));
