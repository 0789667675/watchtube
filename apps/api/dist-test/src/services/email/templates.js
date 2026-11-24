"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWtppStatusEmail = renderWtppStatusEmail;
exports.renderPaymentReceivedEmail = renderPaymentReceivedEmail;
exports.renderWithdrawalRequestedEmail = renderWithdrawalRequestedEmail;
exports.renderWithdrawalDispatchedEmail = renderWithdrawalDispatchedEmail;
exports.renderWithdrawalFailedEmail = renderWithdrawalFailedEmail;
exports.renderSecurityAlertEmail = renderSecurityAlertEmail;
exports.renderVideoProcessingStatusEmail = renderVideoProcessingStatusEmail;
exports.renderWtppReceivedEmail = renderWtppReceivedEmail;
exports.renderCopyrightClaimEmail = renderCopyrightClaimEmail;
exports.renderAdminRoleChangedEmail = renderAdminRoleChangedEmail;
exports.renderPlatformAnnouncementEmail = renderPlatformAnnouncementEmail;
function renderWtppStatusEmail(params) {
    const statusLabels = {
        APPROVED: 'Approved for WatchTube Partner Program',
        REJECTED: 'Application Decision: Not Approved',
        UNDER_REVIEW: 'Application is Under Review',
        CHANGES_REQUESTED: 'Action Required: Application Update Requested',
    };
    const subject = `[WatchTube] ${params.channelName} — ${statusLabels[params.status]}`;
    const text = [
        `Hello,`,
        ``,
        `Your application for the WatchTube Partner Program (WTPP) for channel "${params.channelName}" has been updated.`,
        `Status: ${params.status}`,
        params.reason ? `Notes: ${params.reason}` : '',
        ``,
        `You can review your status and monetization dashboard in WatchTube Creator Studio.`,
        ``,
        `Regards,`,
        `The WatchTube Creator Partnerships Team`,
    ].filter(Boolean).join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a;">WatchTube Partner Program Update</h2>
      <p>Hello,</p>
      <p>Your application for channel <strong>${params.channelName}</strong> has been updated:</p>
      <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; font-weight: bold; color: #0284c7;">Status: ${params.status}</p>
        ${params.reason ? `<p style="margin: 8px 0 0; color: #475569;">${params.reason}</p>` : ''}
      </div>
      <p>Visit Creator Studio to view details or manage your account.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube — Kigali, Rwanda</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'WTPP_STATUS',
        metadata: { ...params },
    };
}
function renderPaymentReceivedEmail(params) {
    const subject = `[WatchTube] Payment Received: ${params.amountRwf} RWF for ${params.channelName}`;
    const text = [
        `Hello,`,
        ``,
        `Great news! A payment of ${params.amountRwf} RWF has been successfully received for "${params.channelName}".`,
        `Provider: ${params.provider}`,
        `Transaction ID: ${params.transactionId}`,
        ``,
        `The funds have been credited to your WatchTube creator wallet ledger and are available for withdrawal according to standard settlement schedules.`,
        ``,
        `Regards,`,
        `The WatchTube Financial Team`,
    ].join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #16a34a;">Payment Received</h2>
      <p>Hello,</p>
      <p>A payment has been successfully credited to <strong>${params.channelName}</strong>:</p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="margin: 0; color: #15803d; font-size: 24px;">+${params.amountRwf} RWF</h3>
        <p style="margin: 8px 0 0; color: #4b5563; font-size: 14px;">Provider: ${params.provider} | Reference: ${params.transactionId}</p>
      </div>
      <p>View your updated balance in Creator Studio Wallet.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Financial Operations</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'PAYMENT_RECEIVED',
        metadata: { ...params },
    };
}
function renderWithdrawalRequestedEmail(params) {
    const subject = `[WatchTube] Withdrawal Requested: ${params.amountRwf} RWF`;
    const text = [
        `Hello,`,
        ``,
        `A withdrawal of ${params.amountRwf} RWF from channel "${params.channelName}" has been initiated.`,
        `Destination: ${params.provider} (${params.maskedPhone})`,
        `Payout ID: ${params.payoutId}`,
        ``,
        `Funds have been reserved and will be dispatched once mobile money network verification completes.`,
        ``,
        `If you did not request this payout, please contact WatchTube Support immediately.`,
        ``,
        `Regards,`,
        `WatchTube Security & Payments`,
    ].join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0284c7;">Withdrawal Requested</h2>
      <p>Hello,</p>
      <p>We received a withdrawal request for <strong>${params.channelName}</strong>:</p>
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; font-size: 18px; font-weight: bold; color: #0f172a;">${params.amountRwf} RWF</p>
        <p style="margin: 4px 0; color: #475569;">Destination: ${params.provider} — ${params.maskedPhone}</p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #94a3b8;">Payout ID: ${params.payoutId}</p>
      </div>
      <p style="font-size: 13px; color: #e11d48;">If you did not authorize this request, please contact support immediately.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Financial Operations</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'WITHDRAWAL_REQUESTED',
        metadata: { ...params },
    };
}
function renderWithdrawalDispatchedEmail(params) {
    const subject = `[WatchTube] Withdrawal Dispatched: ${params.amountRwf} RWF to ${params.maskedPhone}`;
    const text = [
        `Hello,`,
        ``,
        `Your withdrawal of ${params.amountRwf} RWF for channel "${params.channelName}" has been successfully dispatched!`,
        `Provider: ${params.provider}`,
        `Phone: ${params.maskedPhone}`,
        `Provider Reference: ${params.providerReference}`,
        ``,
        `The funds should now reflect in your mobile money wallet.`,
        ``,
        `Regards,`,
        `WatchTube Payments`,
    ].join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #16a34a;">Withdrawal Dispatched</h2>
      <p>Hello,</p>
      <p>Your withdrawal has been successfully transferred to your mobile money account:</p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="margin: 0; color: #15803d; font-size: 20px;">${params.amountRwf} RWF</h3>
        <p style="margin: 4px 0; color: #4b5563;">To: ${params.provider} (${params.maskedPhone})</p>
        <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Provider Ref: ${params.providerReference}</p>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Financial Operations</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'WITHDRAWAL_DISPATCHED',
        metadata: { ...params },
    };
}
function renderWithdrawalFailedEmail(params) {
    const subject = `[WatchTube] Withdrawal Failed: ${params.amountRwf} RWF refunded to wallet`;
    const text = [
        `Hello,`,
        ``,
        `Your withdrawal of ${params.amountRwf} RWF for "${params.channelName}" could not be completed by ${params.provider}.`,
        `Reason: ${params.reason}`,
        ``,
        `The reserved funds have been safely restored to your available wallet balance. No funds were lost.`,
        `Please verify your mobile money number (${params.maskedPhone}) and account status before retrying.`,
        ``,
        `Regards,`,
        `WatchTube Payments`,
    ].join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #dc2626;">Withdrawal Could Not Be Completed</h2>
      <p>Hello,</p>
      <p>Your payout of <strong>${params.amountRwf} RWF</strong> failed at the provider network:</p>
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; font-weight: bold; color: #991b1b;">Reason: ${params.reason}</p>
        <p style="margin: 8px 0 0; color: #4b5563;">All reserved funds have been automatically restored to your available balance.</p>
      </div>
      <p>Please check that your mobile money line is active and registered to receive business disbursements.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Financial Operations</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'WITHDRAWAL_FAILED',
        metadata: { ...params },
    };
}
function renderSecurityAlertEmail(params) {
    const subject = `[WatchTube Security Alert] ${params.title}`;
    const text = [
        `Security Alert:`,
        ``,
        params.details,
        params.actionUrl ? `Action required: ${params.actionUrl}` : '',
        ``,
        `If you did not initiate this change, contact WatchTube Security immediately.`,
    ].filter(Boolean).join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #e11d48;">Security Alert</h2>
      <p><strong>${params.title}</strong></p>
      <div style="background-color: #fff1f2; border: 1px solid #fecdd3; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; color: #881337;">${params.details}</p>
      </div>
      ${params.actionUrl ? `<p><a href="${params.actionUrl}" style="color: #0284c7;">Review Account Security</a></p>` : ''}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Security Team</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'SECURITY_ALERT',
        metadata: { ...params },
    };
}
function renderVideoProcessingStatusEmail(params) {
    const isReady = params.status === 'READY';
    const subject = isReady
        ? `[WatchTube] Your video is ready: "${params.videoTitle}"`
        : `[WatchTube] Video processing issue: "${params.videoTitle}"`;
    const text = isReady
        ? `Great news! Your video "${params.videoTitle}" has finished processing and is ready for viewing/publishing in Creator Studio.`
        : `Unfortunately, processing failed for video "${params.videoTitle}". ${params.errorReason ? `Details: ${params.errorReason}` : 'Please try re-uploading.'}`;
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: ${isReady ? '#16a34a' : '#dc2626'};">${isReady ? 'Video Ready!' : 'Processing Error'}</h2>
      <p>Video: <strong>${params.videoTitle}</strong></p>
      <p>${text}</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Media Processing</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'VIDEO_PROCESSING_STATUS',
        metadata: { ...params },
    };
}
function renderWtppReceivedEmail(params) {
    const subject = `[WatchTube] WTPP Application Received: ${params.channelName}`;
    const text = [
        `Hello,`,
        ``,
        `We have successfully received your application to join the WatchTube Partner Program (WTPP) for "${params.channelName}".`,
        `Our partnership and compliance teams will review your channel activity, content originality, and tax identity information.`,
        ``,
        `You will receive another notification once review is complete.`,
        ``,
        `Regards,`,
        `WatchTube Partner Operations`,
    ].join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0284c7;">WTPP Application Received</h2>
      <p>Hello,</p>
      <p>We received your partnership application for <strong>${params.channelName}</strong>.</p>
      <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; color: #0369a1;">Status: <strong>PENDING REVIEW</strong></p>
        <p style="margin: 8px 0 0; color: #475569; font-size: 14px;">Our review team will examine your channel metrics and compliance standing.</p>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube — Kigali, Rwanda</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'WTPP_RECEIVED',
        metadata: { ...params },
    };
}
function renderCopyrightClaimEmail(params) {
    const isUpheld = params.status === 'CLAIM_UPHELD';
    const isDismissed = params.status === 'CLAIM_DISMISSED';
    const subject = `[WatchTube Notice] Copyright Decision on "${params.videoTitle}"`;
    const text = [
        `Copyright Decision Notice:`,
        ``,
        `Video: "${params.videoTitle}"`,
        `Status: ${params.status}`,
        params.claimantName ? `Claimant: ${params.claimantName}` : '',
        params.resolutionNotes ? `Resolution Notes: ${params.resolutionNotes}` : '',
        ``,
        `If you believe this decision was made in error, you may file a counter-notification in Creator Studio.`,
        ``,
        `WatchTube Trust & Safety`,
    ].filter(Boolean).join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: ${isUpheld ? '#b91c1c' : isDismissed ? '#15803d' : '#d97706'};">Copyright Notice</h2>
      <p>Video: <strong>${params.videoTitle}</strong></p>
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; font-weight: bold;">Status: ${params.status}</p>
        ${params.resolutionNotes ? `<p style="margin: 8px 0 0; color: #475569;">${params.resolutionNotes}</p>` : ''}
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Legal & Copyright Operations</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'COPYRIGHT_CLAIM',
        metadata: { ...params },
    };
}
function renderAdminRoleChangedEmail(params) {
    const subject = `[WatchTube Security] Administrative Access Updated: ${params.newRole}`;
    const text = [
        `Security Notification:`,
        ``,
        `Your administrative account role has been updated to: ${params.newRole}`,
        params.positionAssignment ? `Position Assignment: ${params.positionAssignment}` : '',
        params.grantedBy ? `Updated By: ${params.grantedBy}` : '',
        ``,
        `If you did not expect this administrative change, please notify WatchTube Security immediately.`,
    ].filter(Boolean).join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #4f46e5;">Administrative Role Updated</h2>
      <div style="background-color: #eef2ff; border: 1px solid #c7d2fe; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0; font-weight: bold; color: #3730a3;">New Role: ${params.newRole}</p>
        ${params.positionAssignment ? `<p style="margin: 8px 0 0; color: #4338ca;">Position: ${params.positionAssignment}</p>` : ''}
      </div>
      <p style="color: #b91c1c; font-size: 13px;">If you did not authorize or expect this change, report it immediately.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Company Administration</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'ADMIN_ROLE_CHANGED',
        metadata: { ...params },
    };
}
function renderPlatformAnnouncementEmail(params) {
    const subject = `[WatchTube Announcement] ${params.title}`;
    const text = [
        params.title,
        ``,
        params.content,
        params.actionUrl ? `Learn more: ${params.actionUrl}` : '',
        ``,
        `The WatchTube Team`,
    ].filter(Boolean).join('\n');
    const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a;">${params.title}</h2>
      <p style="line-height: 1.6; color: #334155;">${params.content}</p>
      ${params.actionUrl ? `<p><a href="${params.actionUrl}" style="color: #0284c7; font-weight: bold;">Learn More</a></p>` : ''}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">WatchTube Announcements</p>
    </div>
  `;
    return {
        to: params.recipientEmail,
        subject,
        text,
        html,
        templateId: 'PLATFORM_ANNOUNCEMENT',
        metadata: { ...params },
    };
}
