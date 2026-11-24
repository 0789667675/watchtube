"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuthenticate = exports.authenticate = void 0;
exports.createAuthenticate = createAuthenticate;
exports.createOptionalAuthenticate = createOptionalAuthenticate;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("@watchtube/database");
const jwt_1 = require("../config/jwt");
const databaseErrors_1 = require("../config/databaseErrors");
function createAuthenticate(findUser) {
    return async (req, res, next) => {
        const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
        if (!token) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        let userId;
        try {
            const decoded = jsonwebtoken_1.default.verify(token, jwt_1.JWT_SECRET);
            if (typeof decoded === 'string' || typeof decoded.id !== 'string') {
                res.status(401).json({ error: 'Invalid token' });
                return;
            }
            userId = decoded.id;
        }
        catch {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }
        let user;
        try {
            user = await findUser(userId);
        }
        catch (error) {
            console.error(`[API] Authentication user lookup failed${(0, databaseErrors_1.isDatabaseUnavailable)(error) ? ' because the database is unavailable.' : '.'}`);
            const message = (0, databaseErrors_1.isDatabaseUnavailable)(error)
                ? 'Authentication is temporarily unavailable because the database is unavailable'
                : 'Authentication is temporarily unavailable';
            res.status(503).json({ error: message });
            return;
        }
        if (!user) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if (user.status === 'RESTRICTED' || user.status === 'SUSPENDED') {
            res.status(403).json({ error: 'Account access is restricted' });
            return;
        }
        req.user = { id: user.id, role: user.role };
        next();
    };
}
function createOptionalAuthenticate(findUser) {
    const authenticateUser = createAuthenticate(findUser);
    return (req, res, next) => {
        const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
        if (!token) {
            next();
            return;
        }
        return authenticateUser(req, res, next);
    };
}
const findAuthenticatedUser = async (id) => database_1.db.user.findUnique({
    where: { id },
    select: { id: true, role: true, status: true },
});
exports.authenticate = createAuthenticate(findAuthenticatedUser);
exports.optionalAuthenticate = createOptionalAuthenticate(findAuthenticatedUser);
