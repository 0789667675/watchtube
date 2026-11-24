"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
exports.createAuthRouter = createAuthRouter;
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const database_1 = require("@watchtube/database");
const auth_1 = require("../middleware/auth");
const databaseErrors_1 = require("../config/databaseErrors");
const jwt_1 = require("../config/jwt");
const registerSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
});
const ADMIN_POSITION_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MODERATOR']);
function createAuthRouter(options = {}) {
    const router = express_1.default.Router();
    const dbClient = options.prismaClient ?? database_1.db;
    const authMiddleware = options.authenticateMiddleware ?? auth_1.authenticate;
    router.post('/register', async (req, res) => {
        try {
            const { email, password } = registerSchema.parse(req.body);
            const existing = await dbClient.user.findUnique({ where: { email } });
            if (existing) {
                res.status(400).json({ error: 'Email in use' });
                return;
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 10);
            const user = await dbClient.user.create({
                data: { email, passwordHash, status: 'GOOD_STANDING' }
            });
            res.status(201).json({ id: user.id, email: user.email });
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                res.status(400).json({ error: 'Invalid request' });
                return;
            }
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Registration is temporarily unavailable because the database is unavailable.');
        }
    });
    router.post('/login', async (req, res) => {
        try {
            const { email, password } = registerSchema.parse(req.body);
            const user = await dbClient.user.findUnique({ where: { email } });
            if (!user || !(await bcryptjs_1.default.compare(password, user.passwordHash))) {
                res.status(401).json({ error: 'Invalid credentials' });
                return;
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id }, jwt_1.JWT_SECRET, { expiresIn: '7d' });
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                path: '/',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });
            res.status(200).json({ success: true });
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                res.status(400).json({ error: 'Invalid request' });
                return;
            }
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Sign-in is temporarily unavailable because the database is unavailable.');
        }
    });
    router.post('/logout', (req, res) => {
        res.clearCookie('token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            path: '/',
        });
        res.status(200).json({ success: true });
    });
    router.get('/me', authMiddleware, async (req, res) => {
        try {
            const user = await dbClient.user.findUnique({
                where: { id: req.user.id },
                select: {
                    id: true,
                    email: true,
                    role: true,
                    status: true,
                    channels: {
                        select: {
                            id: true,
                            name: true,
                            handle: true,
                            description: true,
                            avatarUrl: true,
                            bannerUrl: true,
                        },
                        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                    },
                },
            });
            if (!user) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            let adminPosition = null;
            if (ADMIN_POSITION_ROLES.has(user.role) && typeof dbClient.adminPosition?.findUnique === 'function') {
                adminPosition = await dbClient.adminPosition.findUnique({
                    where: { userId: user.id },
                    select: {
                        positionNumber: true,
                        assignment: true,
                        permissions: true,
                        status: true,
                    },
                });
            }
            const responseData = {
                id: user.id,
                email: user.email,
                role: user.role,
                status: user.status,
                channels: user.channels,
                positionNumber: adminPosition?.positionNumber ?? null,
                assignment: adminPosition?.assignment ?? null,
                permissions: user.role === 'SUPER_ADMIN'
                    ? ['*']
                    : adminPosition?.status === 'OCCUPIED'
                        ? adminPosition.permissions ?? []
                        : [],
            };
            res.status(200).json(responseData);
        }
        catch (error) {
            (0, databaseErrors_1.sendDatabaseErrorResponse)(res, error, 'Account details are temporarily unavailable because the database is unavailable.');
        }
    });
    return router;
}
const authRouter = createAuthRouter();
exports.authRouter = authRouter;
