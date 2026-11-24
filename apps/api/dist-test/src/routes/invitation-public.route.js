"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitationPublicRouter = void 0;
exports.createInvitationPublicRouter = createInvitationPublicRouter;
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const adminManagement_service_1 = require("../services/adminManagement.service");
const databaseErrors_1 = require("../config/databaseErrors");
function createInvitationPublicRouter(service = {
    verifyInvitationToken: adminManagement_service_1.verifyInvitationToken,
    acceptInvitation: adminManagement_service_1.acceptInvitation,
}) {
    const router = express_1.default.Router();
    // Verify invitation token (public)
    router.get('/verify/:token', async (req, res) => {
        try {
            const token = req.params.token;
            if (!token) {
                res.status(400).json({ error: 'Token is required.' });
                return;
            }
            const verification = await service.verifyInvitationToken(token);
            if (!verification.valid) {
                res.status(400).json({ error: verification.error });
                return;
            }
            res.status(200).json(verification.invitation);
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Invitation verification is temporarily unavailable because the database is unavailable.');
        }
    });
    const acceptSchema = zod_1.z.object({
        token: zod_1.z.string().min(16),
        password: zod_1.z.string().min(8),
    });
    // Accept invitation and establish individual admin account (public)
    router.post('/accept', async (req, res) => {
        try {
            const { token, password } = acceptSchema.parse(req.body);
            const result = await service.acceptInvitation({ token, password });
            res.status(200).json({
                success: true,
                message: 'Invitation accepted successfully. You may now log in to the Admin Portal.',
                account: {
                    userId: result.userId,
                    email: result.email,
                    positionNumber: result.positionNumber,
                },
            });
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                res.status(400).json({ error: 'Password must be at least 8 characters long.' });
                return;
            }
            if ((0, databaseErrors_1.isDatabaseUnavailable)(error)) {
                (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Invitation acceptance is temporarily unavailable because the database is unavailable.');
                return;
            }
            res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to accept invitation.' });
        }
    });
    return router;
}
exports.invitationPublicRouter = createInvitationPublicRouter();
