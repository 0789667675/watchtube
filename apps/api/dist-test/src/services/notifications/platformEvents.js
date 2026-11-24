"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformEventDispatcher = void 0;
exports.getPlatformEventDispatcher = getPlatformEventDispatcher;
exports.setPlatformEventDispatcher = setPlatformEventDispatcher;
exports.emitPlatformEvent = emitPlatformEvent;
const notification_service_1 = require("./notification.service");
const email_1 = require("../email");
class PlatformEventDispatcher {
    notificationService;
    emailDispatcher;
    constructor(notificationService, emailDispatcher = (0, email_1.getEmailDispatcher)()) {
        this.notificationService = notificationService;
        this.emailDispatcher = emailDispatcher;
    }
    /**
     * Dispatches a platform lifecycle event to persistent in-app notifications
     * and the durable email outbox, respecting user preferences and mandatory security overrides.
     */
    async dispatchPlatformEvent(event) {
        try {
            const repo = this.notificationService.getRepository();
            const prefs = typeof repo.getPreferences === 'function'
                ? await repo.getPreferences(event.userId)
                : {
                    userId: event.userId,
                    emailSecurityAlerts: true,
                    emailFinancialTransfers: true,
                    emailWtppUpdates: true,
                    emailVideoProcessing: true,
                    emailPlatformAnnouncements: true,
                    inAppFinancialAlerts: true,
                    inAppVideoProcessing: true,
                    inAppPlatformAnnouncements: true,
                };
            const recipientEmail = event.recipientEmail || (await repo.findUserEmail(event.userId));
            let inAppCreated = false;
            let emailEnqueued = false;
            switch (event.eventType) {
                case 'WTPP_APPLICATION_RECEIVED': {
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title: 'WTPP Application Received',
                        message: `Your application to the WatchTube Partner Program for "${event.channelName}" has been received.`,
                        metadata: { applicationId: event.applicationId, channelId: event.channelId },
                    });
                    inAppCreated = true;
                    if (recipientEmail && prefs.emailWtppUpdates) {
                        const email = (0, email_1.renderWtppReceivedEmail)({
                            recipientEmail,
                            channelName: event.channelName,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `wtpp:received:${event.applicationId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'WTPP_APPLICATION_APPROVED':
                case 'WTPP_APPLICATION_REJECTED':
                case 'WTPP_APPLICATION_UNDER_REVIEW':
                case 'WTPP_APPLICATION_CHANGES_REQUESTED': {
                    const statusMap = {
                        WTPP_APPLICATION_APPROVED: 'APPROVED',
                        WTPP_APPLICATION_REJECTED: 'REJECTED',
                        WTPP_APPLICATION_UNDER_REVIEW: 'UNDER_REVIEW',
                        WTPP_APPLICATION_CHANGES_REQUESTED: 'CHANGES_REQUESTED',
                    };
                    const status = statusMap[event.eventType];
                    const title = `WTPP Application ${status.replace('_', ' ')}`;
                    const notes = event.reviewerNotes ? `: ${event.reviewerNotes}` : '';
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title,
                        message: `Your WTPP application for "${event.channelName}" is now ${status}${notes}.`,
                        metadata: {
                            applicationId: event.applicationId,
                            status,
                            reviewerNotes: event.reviewerNotes,
                        },
                    });
                    inAppCreated = true;
                    if (recipientEmail && prefs.emailWtppUpdates) {
                        const email = (0, email_1.renderWtppStatusEmail)({
                            recipientEmail,
                            channelName: event.channelName,
                            status,
                            reason: event.reviewerNotes ?? undefined,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `wtpp:status:${event.applicationId}:${status}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'VIDEO_PROCESSING_COMPLETED': {
                    if (prefs.inAppVideoProcessing) {
                        await this.notificationService.createNotification({
                            userId: event.userId,
                            type: event.eventType,
                            title: 'Video Ready for Review',
                            message: `Your video "${event.videoTitle}" has finished processing and is ready for review.`,
                            metadata: { videoId: event.videoId },
                        });
                        inAppCreated = true;
                    }
                    if (recipientEmail && prefs.emailVideoProcessing) {
                        const email = (0, email_1.renderVideoProcessingStatusEmail)({
                            recipientEmail,
                            videoTitle: event.videoTitle,
                            status: 'READY',
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `video:ready:${event.videoId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'VIDEO_PROCESSING_FAILED': {
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title: 'Video Processing Issue',
                        message: `Video processing could not be completed for "${event.videoTitle}". ${event.errorReason || ''}`,
                        metadata: { videoId: event.videoId, error: event.errorReason },
                    });
                    inAppCreated = true;
                    if (recipientEmail && prefs.emailVideoProcessing) {
                        const email = (0, email_1.renderVideoProcessingStatusEmail)({
                            recipientEmail,
                            videoTitle: event.videoTitle,
                            status: 'FAILED',
                            errorReason: event.errorReason,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `video:failed:${event.videoId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'VIDEO_PUBLISHED': {
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title: 'Video Published',
                        message: `"${event.videoTitle}" is now live on WatchTube!`,
                        metadata: { videoId: event.videoId },
                    });
                    inAppCreated = true;
                    if (recipientEmail && prefs.emailVideoProcessing) {
                        const email = (0, email_1.renderVideoProcessingStatusEmail)({
                            recipientEmail,
                            videoTitle: event.videoTitle,
                            status: 'READY',
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `video:published:${event.videoId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'ACCOUNT_SECURITY_ALERT': {
                    // Mandatory security event: cannot be disabled by user preferences
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title: event.title,
                        message: event.details,
                        metadata: { actionUrl: event.actionUrl },
                    });
                    inAppCreated = true;
                    if (recipientEmail) {
                        const email = (0, email_1.renderSecurityAlertEmail)({
                            recipientEmail,
                            title: event.title,
                            details: event.details,
                            actionUrl: event.actionUrl,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `sec:alert:${event.userId}:${event.eventId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'ADMIN_ROLE_CHANGED': {
                    // Mandatory security/access notification
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title: 'Administrative Access Updated',
                        message: `Your role has been updated to ${event.newRole}.`,
                        metadata: {
                            newRole: event.newRole,
                            positionAssignment: event.positionAssignment,
                            grantedBy: event.grantedBy,
                        },
                    });
                    inAppCreated = true;
                    if (recipientEmail) {
                        const email = (0, email_1.renderAdminRoleChangedEmail)({
                            recipientEmail,
                            newRole: event.newRole,
                            positionAssignment: event.positionAssignment,
                            grantedBy: event.grantedBy,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `admin:role:${event.userId}:${event.eventId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'COPYRIGHT_DECISION': {
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title: 'Copyright Claim Update',
                        message: `A decision was made regarding "${event.videoTitle}": ${event.status}.`,
                        metadata: {
                            claimId: event.claimId,
                            videoId: event.videoId,
                            status: event.status,
                        },
                    });
                    inAppCreated = true;
                    if (recipientEmail) {
                        const email = (0, email_1.renderCopyrightClaimEmail)({
                            recipientEmail,
                            videoTitle: event.videoTitle,
                            status: event.status,
                            claimantName: event.claimantName,
                            resolutionNotes: event.resolutionNotes,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `copyright:${event.claimId}:${event.status}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'MODERATION_STRIKE_ISSUED': {
                    await this.notificationService.createNotification({
                        userId: event.userId,
                        type: event.eventType,
                        title: 'Community Guidelines Strike',
                        message: `A strike of type "${event.strikeType}" was recorded on your account: ${event.reason}.`,
                        metadata: { strikeType: event.strikeType, reason: event.reason },
                    });
                    inAppCreated = true;
                    if (recipientEmail) {
                        const email = (0, email_1.renderSecurityAlertEmail)({
                            recipientEmail,
                            title: `Community Guidelines Strike: ${event.strikeType}`,
                            details: `A moderation strike was issued on your account: ${event.reason}. Repeated violations may result in feature restriction or account suspension.`,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `strike:${event.userId}:${event.eventId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
                case 'PLATFORM_ANNOUNCEMENT': {
                    if (prefs.inAppPlatformAnnouncements) {
                        await this.notificationService.createNotification({
                            userId: event.userId,
                            type: event.eventType,
                            title: event.title,
                            message: event.content,
                            metadata: { actionUrl: event.actionUrl },
                        });
                        inAppCreated = true;
                    }
                    if (recipientEmail && prefs.emailPlatformAnnouncements) {
                        const email = (0, email_1.renderPlatformAnnouncementEmail)({
                            recipientEmail,
                            title: event.title,
                            content: event.content,
                            actionUrl: event.actionUrl,
                        });
                        await this.emailDispatcher.dispatchDurableEmail(email, `announcement:${event.eventId}:${event.userId}`);
                        emailEnqueued = true;
                    }
                    break;
                }
            }
            return { inAppCreated, emailEnqueued };
        }
        catch (err) {
            console.error(`[PlatformEventDispatcher] Failed to dispatch event ${event.eventType} for user ${event.userId}:`, err instanceof Error ? err.message : err);
            return { inAppCreated: false, emailEnqueued: false };
        }
    }
}
exports.PlatformEventDispatcher = PlatformEventDispatcher;
let platformEventDispatcherInstance = null;
function getPlatformEventDispatcher() {
    if (!platformEventDispatcherInstance) {
        platformEventDispatcherInstance = new PlatformEventDispatcher((0, notification_service_1.getNotificationService)());
    }
    return platformEventDispatcherInstance;
}
function setPlatformEventDispatcher(dispatcher) {
    platformEventDispatcherInstance = dispatcher;
}
async function emitPlatformEvent(event) {
    try {
        return await getPlatformEventDispatcher().dispatchPlatformEvent(event);
    }
    catch (err) {
        console.error(`[emitPlatformEvent] Unhandled error dispatching ${event.eventType} for user ${event.userId}:`, err instanceof Error ? err.message : err);
        return { inAppCreated: false, emailEnqueued: false };
    }
}
