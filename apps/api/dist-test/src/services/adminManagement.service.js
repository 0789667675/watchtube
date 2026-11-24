"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashToken = hashToken;
exports.ensureAdminPositionsExist = ensureAdminPositionsExist;
exports.getAdminPositions = getAdminPositions;
exports.inviteAdmin = inviteAdmin;
exports.listAdminInvitations = listAdminInvitations;
exports.revokeInvitation = revokeInvitation;
exports.resendInvitation = resendInvitation;
exports.verifyInvitationToken = verifyInvitationToken;
exports.acceptInvitation = acceptInvitation;
exports.suspendAdmin = suspendAdmin;
exports.restoreAdmin = restoreAdmin;
exports.revokeAdminPosition = revokeAdminPosition;
exports.updateAdminPermissions = updateAdminPermissions;
const node_crypto_1 = __importDefault(require("node:crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("@watchtube/database");
const audit_service_1 = require("./audit.service");
const permissions_1 = require("../security/permissions");
const notifications_1 = require("./notifications");
function hashToken(token) {
    return node_crypto_1.default.createHash('sha256').update(token).digest('hex');
}
/**
 * Ensures the three designated Admin positions (1, 2, 3) exist in the database.
 */
async function ensureAdminPositionsExist() {
    const positions = [1, 2, 3];
    for (const pos of positions) {
        await database_1.db.adminPosition.upsert({
            where: { positionNumber: pos },
            update: {},
            create: {
                positionNumber: pos,
                status: 'VACANT',
                permissions: [],
            },
        });
    }
}
/**
 * Returns all three designated Admin positions with occupied/vacant status, assignments, and partner details.
 */
async function getAdminPositions() {
    await ensureAdminPositionsExist();
    const positions = await database_1.db.adminPosition.findMany({
        orderBy: { positionNumber: 'asc' },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    status: true,
                    createdAt: true,
                },
            },
        },
    });
    return positions;
}
/**
 * Generates and stores a secure, single-use, time-limited invitation for an available Admin position.
 */
async function inviteAdmin(input) {
    const email = input.email.trim().toLowerCase();
    const positionNumber = Number(input.positionNumber);
    if (![1, 2, 3].includes(positionNumber)) {
        throw new Error('Position number must be 1, 2, or 3.');
    }
    if (!input.assignment?.trim()) {
        throw new Error('An assignment description is required for this Admin position.');
    }
    // Filter out any accidentally or maliciously passed owner-only permissions
    const safePermissions = (input.customPermissions ?? []).filter((perm) => !permissions_1.OWNER_ONLY_PERMISSIONS.includes(perm));
    await ensureAdminPositionsExist();
    // Check if position is currently occupied
    const position = await database_1.db.adminPosition.findUnique({
        where: { positionNumber },
    });
    if (!position) {
        throw new Error('Invalid Admin position.');
    }
    if (position.status === 'OCCUPIED' && position.userId) {
        throw new Error(`Admin Position ${positionNumber} is currently occupied. Revoke or replace the existing admin first.`);
    }
    // Prevent inviting SUPER_ADMIN or currently active Admin partners
    const targetUser = await database_1.db.user.findUnique({ where: { email } });
    if (targetUser && targetUser.role === 'SUPER_ADMIN') {
        throw new Error('The SUPER_ADMIN (Owner/CEO) account cannot be invited to an Admin position.');
    }
    const existingPosition = await database_1.db.adminPosition.findFirst({
        where: { user: { email }, status: 'OCCUPIED' },
    });
    if (existingPosition) {
        throw new Error(`User with email ${email} is already assigned to Admin Position ${existingPosition.positionNumber}.`);
    }
    // Check if there is an active pending invitation for this position or email
    const existingActive = await database_1.db.adminInvitation.findFirst({
        where: {
            OR: [
                { positionNumber, status: 'PENDING', expiresAt: { gt: new Date() } },
                { email, status: 'PENDING', expiresAt: { gt: new Date() } },
            ],
        },
    });
    if (existingActive) {
        throw new Error(`An active invitation already exists for position ${positionNumber} or email ${email}. Revoke it before issuing a new one.`);
    }
    // Generate 32-byte cryptographically secure random token
    const rawToken = node_crypto_1.default.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48-hour expiration
    const invitation = await database_1.db.adminInvitation.create({
        data: {
            email,
            positionNumber,
            assignment: input.assignment.trim(),
            customPermissions: safePermissions,
            tokenHash,
            status: 'PENDING',
            invitedById: input.invitedById,
            expiresAt,
        },
        include: {
            invitedBy: {
                select: { id: true, email: true },
            },
        },
    });
    await (0, audit_service_1.recordAuditEvent)({
        actorId: input.invitedById,
        actorRole: 'SUPER_ADMIN',
        action: 'ADMIN_INVITED',
        targetResource: 'ADMIN_INVITATION',
        targetId: invitation.id,
        metadata: {
            email,
            positionNumber,
            assignment: input.assignment,
            customPermissions: safePermissions,
            expiresAt: expiresAt.toISOString(),
        },
    });
    return {
        invitation,
        inviteToken: rawToken, // Single-use token returned so the owner can securely provide or email it
    };
}
/**
 * Lists all invitations for SUPER_ADMIN oversight.
 */
async function listAdminInvitations() {
    return database_1.db.adminInvitation.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            invitedBy: { select: { id: true, email: true } },
            acceptedBy: { select: { id: true, email: true } },
        },
    });
}
/**
 * Revokes a pending invitation.
 */
async function revokeInvitation(invitationId, actorId) {
    const invitation = await database_1.db.adminInvitation.findUnique({
        where: { id: invitationId },
    });
    if (!invitation) {
        throw new Error('Invitation not found.');
    }
    if (invitation.status !== 'PENDING') {
        throw new Error(`Cannot revoke invitation with status '${invitation.status}'.`);
    }
    const updated = await database_1.db.adminInvitation.update({
        where: { id: invitationId },
        data: { status: 'REVOKED' },
    });
    await (0, audit_service_1.recordAuditEvent)({
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'ADMIN_INVITATION_REVOKED',
        targetResource: 'ADMIN_INVITATION',
        targetId: invitationId,
        metadata: { email: invitation.email, positionNumber: invitation.positionNumber },
    });
    return updated;
}
/**
 * Resends / refreshes a pending or expired invitation with a fresh token.
 */
async function resendInvitation(invitationId, actorId) {
    const invitation = await database_1.db.adminInvitation.findUnique({
        where: { id: invitationId },
    });
    if (!invitation) {
        throw new Error('Invitation not found.');
    }
    if (invitation.status === 'ACCEPTED') {
        throw new Error('Cannot resend an already accepted invitation.');
    }
    const rawToken = node_crypto_1.default.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const updated = await database_1.db.adminInvitation.update({
        where: { id: invitationId },
        data: {
            tokenHash,
            status: 'PENDING',
            expiresAt,
        },
    });
    await (0, audit_service_1.recordAuditEvent)({
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'ADMIN_INVITATION_RESENT',
        targetResource: 'ADMIN_INVITATION',
        targetId: invitationId,
        metadata: { email: invitation.email, positionNumber: invitation.positionNumber },
    });
    return {
        invitation: updated,
        inviteToken: rawToken,
    };
}
/**
 * Validates an invite token and returns details for the invite acceptance view.
 */
async function verifyInvitationToken(token) {
    const tokenHash = hashToken(token);
    const invitation = await database_1.db.adminInvitation.findUnique({
        where: { tokenHash },
        include: {
            invitedBy: { select: { email: true } },
        },
    });
    if (!invitation) {
        return { valid: false, error: 'Invalid or unknown invitation token.' };
    }
    if (invitation.status !== 'PENDING') {
        return { valid: false, error: `This invitation has already been ${invitation.status.toLowerCase()}.` };
    }
    if (new Date() > invitation.expiresAt) {
        return { valid: false, error: 'This invitation has expired. Request a new invitation from the administrator.' };
    }
    return {
        valid: true,
        invitation: {
            id: invitation.id,
            email: invitation.email,
            positionNumber: invitation.positionNumber,
            assignment: invitation.assignment,
            invitedByEmail: invitation.invitedBy.email,
            expiresAt: invitation.expiresAt,
        },
    };
}
/**
 * Accepts an invitation: establishes individual partner account, assigns position and permissions.
 */
async function acceptInvitation(input) {
    if (!input.token || !input.password || input.password.length < 8) {
        throw new Error('Valid token and password (at least 8 characters) are required.');
    }
    const tokenHash = hashToken(input.token);
    return database_1.db.$transaction(async (tx) => {
        const invitation = await tx.adminInvitation.findUnique({
            where: { tokenHash },
        });
        if (!invitation) {
            throw new Error('Invalid or unknown invitation token.');
        }
        if (invitation.status !== 'PENDING') {
            throw new Error(`This invitation is no longer valid (status: ${invitation.status}).`);
        }
        if (new Date() > invitation.expiresAt) {
            await tx.adminInvitation.update({
                where: { id: invitation.id },
                data: { status: 'EXPIRED' },
            });
            throw new Error('This invitation has expired.');
        }
        // Verify target position is still vacant
        const position = await tx.adminPosition.findUnique({
            where: { positionNumber: invitation.positionNumber },
        });
        if (!position || (position.status === 'OCCUPIED' && position.userId)) {
            throw new Error(`Position ${invitation.positionNumber} is no longer vacant.`);
        }
        // Safety checks on existing account to protect owner and prevent privilege escalation
        const existingUser = await tx.user.findUnique({
            where: { email: invitation.email },
        });
        if (existingUser && existingUser.role === 'SUPER_ADMIN') {
            throw new Error('The SUPER_ADMIN account cannot be converted to an Admin partner.');
        }
        if (existingUser && existingUser.status === 'SUSPENDED') {
            throw new Error('This account is suspended and cannot be appointed to an Admin position.');
        }
        // Ensure the user does not already occupy another Admin position
        if (existingUser) {
            const alreadyOccupied = await tx.adminPosition.findFirst({
                where: { userId: existingUser.id, status: 'OCCUPIED' },
            });
            if (alreadyOccupied && alreadyOccupied.positionNumber !== invitation.positionNumber) {
                throw new Error(`User is already assigned to Admin Position ${alreadyOccupied.positionNumber}.`);
            }
        }
        const passwordHash = await bcryptjs_1.default.hash(input.password, 10);
        // Upsert or create individual user account for the invited partner
        const user = await tx.user.upsert({
            where: { email: invitation.email },
            update: {
                passwordHash,
                role: 'ADMIN',
                status: 'GOOD_STANDING',
            },
            create: {
                email: invitation.email,
                passwordHash,
                role: 'ADMIN',
                status: 'GOOD_STANDING',
            },
        });
        // Atomically claim the position to prevent concurrent race conditions
        const updatePosition = await tx.adminPosition.updateMany({
            where: {
                positionNumber: invitation.positionNumber,
                status: 'VACANT',
                userId: null,
            },
            data: {
                status: 'OCCUPIED',
                userId: user.id,
                assignment: invitation.assignment,
                permissions: invitation.customPermissions,
                assignedAt: new Date(),
            },
        });
        if (updatePosition.count !== 1) {
            throw new Error(`Position ${invitation.positionNumber} is no longer vacant.`);
        }
        // Atomically mark invitation as accepted
        const updateInvite = await tx.adminInvitation.updateMany({
            where: {
                id: invitation.id,
                status: 'PENDING',
            },
            data: {
                status: 'ACCEPTED',
                acceptedById: user.id,
            },
        });
        if (updateInvite.count !== 1) {
            throw new Error('This invitation has already been accepted or is no longer pending.');
        }
        return {
            userId: user.id,
            email: user.email,
            role: user.role,
            positionNumber: invitation.positionNumber,
            assignment: invitation.assignment,
        };
    }).then(async (result) => {
        await (0, audit_service_1.recordAuditEvent)({
            actorId: result.userId,
            actorRole: 'ADMIN',
            action: 'ADMIN_INVITATION_ACCEPTED',
            targetResource: 'ADMIN_POSITION',
            targetId: String(result.positionNumber),
            metadata: {
                email: result.email,
                positionNumber: result.positionNumber,
                assignment: result.assignment,
            },
        });
        void (0, notifications_1.emitPlatformEvent)({
            eventId: node_crypto_1.default.randomUUID(),
            eventType: 'ADMIN_ROLE_CHANGED',
            userId: result.userId,
            recipientEmail: result.email,
            newRole: result.role,
            positionAssignment: result.assignment,
            timestamp: new Date(),
        });
        return result;
    });
}
/**
 * Suspends an occupied Admin position and user account.
 */
async function suspendAdmin(positionNumber, actorId, reason) {
    const position = await database_1.db.adminPosition.findUnique({
        where: { positionNumber },
        include: { user: true },
    });
    if (!position || !position.userId || !position.user) {
        throw new Error(`Admin Position ${positionNumber} is not occupied.`);
    }
    // Safety protection: SUPER_ADMIN cannot be suspended by this route
    if (position.user.role === 'SUPER_ADMIN') {
        throw new Error('The SUPER_ADMIN account cannot be suspended.');
    }
    await database_1.db.$transaction([
        database_1.db.adminPosition.update({
            where: { positionNumber },
            data: { status: 'SUSPENDED' },
        }),
        database_1.db.user.update({
            where: { id: position.userId },
            data: { status: 'SUSPENDED' },
        }),
    ]);
    await (0, audit_service_1.recordAuditEvent)({
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'ADMIN_SUSPENDED',
        targetResource: 'ADMIN_POSITION',
        targetId: String(positionNumber),
        metadata: {
            targetUserId: position.userId,
            targetEmail: position.user.email,
            reason: reason || 'Suspended by SUPER_ADMIN',
        },
    });
    return { success: true, positionNumber, status: 'SUSPENDED' };
}
/**
 * Restores a suspended Admin position and user account.
 */
async function restoreAdmin(positionNumber, actorId) {
    const position = await database_1.db.adminPosition.findUnique({
        where: { positionNumber },
        include: { user: true },
    });
    if (!position || !position.userId || !position.user) {
        throw new Error(`Admin Position ${positionNumber} is not occupied.`);
    }
    await database_1.db.$transaction([
        database_1.db.adminPosition.update({
            where: { positionNumber },
            data: { status: 'OCCUPIED' },
        }),
        database_1.db.user.update({
            where: { id: position.userId },
            data: { status: 'GOOD_STANDING' },
        }),
    ]);
    await (0, audit_service_1.recordAuditEvent)({
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'ADMIN_RESTORED',
        targetResource: 'ADMIN_POSITION',
        targetId: String(positionNumber),
        metadata: {
            targetUserId: position.userId,
            targetEmail: position.user.email,
        },
    });
    return { success: true, positionNumber, status: 'OCCUPIED' };
}
/**
 * Revokes an Admin position, vacates the position, and demotes the partner to USER.
 * Historical audit and activity records remain preserved.
 */
async function revokeAdminPosition(positionNumber, actorId, reason) {
    const position = await database_1.db.adminPosition.findUnique({
        where: { positionNumber },
        include: { user: true },
    });
    if (!position || !position.userId || !position.user) {
        throw new Error(`Admin Position ${positionNumber} is not occupied.`);
    }
    // Safety protection: SUPER_ADMIN cannot be revoked
    if (position.user.role === 'SUPER_ADMIN') {
        throw new Error('The SUPER_ADMIN account cannot be revoked.');
    }
    const previousUser = position.user;
    await database_1.db.$transaction([
        database_1.db.adminPosition.update({
            where: { positionNumber },
            data: {
                status: 'VACANT',
                userId: null,
                assignment: null,
                permissions: [],
                assignedAt: null,
            },
        }),
        database_1.db.user.update({
            where: { id: previousUser.id },
            data: {
                role: 'USER',
            },
        }),
    ]);
    await (0, audit_service_1.recordAuditEvent)({
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'ADMIN_REVOKED',
        targetResource: 'ADMIN_POSITION',
        targetId: String(positionNumber),
        metadata: {
            revokedUserId: previousUser.id,
            revokedEmail: previousUser.email,
            reason: reason || 'Revoked by SUPER_ADMIN',
        },
    });
    void (0, notifications_1.emitPlatformEvent)({
        eventId: node_crypto_1.default.randomUUID(),
        eventType: 'ADMIN_ROLE_CHANGED',
        userId: previousUser.id,
        recipientEmail: previousUser.email,
        newRole: 'USER',
        positionAssignment: 'Revoked',
        timestamp: new Date(),
    });
    return { success: true, positionNumber, status: 'VACANT' };
}
/**
 * Updates an Admin position's assignment and custom permissions.
 */
async function updateAdminPermissions(positionNumber, assignment, customPermissions, actorId) {
    const position = await database_1.db.adminPosition.findUnique({
        where: { positionNumber },
        include: { user: true },
    });
    if (!position) {
        throw new Error(`Admin Position ${positionNumber} not found.`);
    }
    // Filter out any owner-only permissions
    const safePermissions = customPermissions.filter((perm) => !permissions_1.OWNER_ONLY_PERMISSIONS.includes(perm));
    const updated = await database_1.db.adminPosition.update({
        where: { positionNumber },
        data: {
            assignment: assignment.trim(),
            permissions: safePermissions,
        },
    });
    await (0, audit_service_1.recordAuditEvent)({
        actorId,
        actorRole: 'SUPER_ADMIN',
        action: 'ADMIN_PERMISSIONS_UPDATED',
        targetResource: 'ADMIN_POSITION',
        targetId: String(positionNumber),
        metadata: {
            assignment: assignment.trim(),
            permissions: safePermissions,
            targetUserId: position.userId,
        },
    });
    return updated;
}
