export const STUDIO_CHANNEL_IMAGE_MAX_FILE_SIZE = {
    avatar: 5 * 1024 * 1024,
    banner: 10 * 1024 * 1024,
};
export function isStudioChannel(value) {
    return isRecord(value)
        && typeof value.id === 'string'
        && typeof value.name === 'string'
        && typeof value.handle === 'string'
        && (value.description === undefined || value.description === null || typeof value.description === 'string')
        && (value.avatarUrl === undefined || value.avatarUrl === null || typeof value.avatarUrl === 'string')
        && (value.bannerUrl === undefined || value.bannerUrl === null || typeof value.bannerUrl === 'string');
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isStudioChannelSettings(value) {
    return isRecord(value)
        && typeof value.id === 'string'
        && typeof value.name === 'string'
        && typeof value.handle === 'string'
        && (value.description === null || typeof value.description === 'string')
        && (value.avatarUrl === null || typeof value.avatarUrl === 'string')
        && (value.bannerUrl === null || typeof value.bannerUrl === 'string');
}
export function isStudioChannelImageUploadIntent(value) {
    if (!isRecord(value)
        || typeof value.uploadUrl !== 'string'
        || typeof value.uploadToken !== 'string'
        || value.uploadToken.length === 0
        || value.uploadToken.length > 4096
        || !Number.isInteger(value.expiresIn)
        || Number(value.expiresIn) < 1
        || Number(value.expiresIn) > 900)
        return false;
    try {
        const url = new URL(value.uploadUrl);
        return url.protocol === 'https:' && !url.username && !url.password;
    }
    catch {
        return false;
    }
}
export function isStudioChannelImageConfirmation(value, purpose) {
    if (!isRecord(value) || !isStudioChannelSettings(value.channel) || typeof value.imageUrl !== 'string') {
        return false;
    }
    const savedUrl = purpose === 'avatar' ? value.channel.avatarUrl : value.channel.bannerUrl;
    if (savedUrl !== value.imageUrl)
        return false;
    try {
        const url = new URL(value.imageUrl);
        return url.protocol === 'https:' && !url.username && !url.password;
    }
    catch {
        return false;
    }
}
export function isStudioCommentPage(value) {
    return isRecord(value)
        && Array.isArray(value.comments)
        && Number.isInteger(value.page) && Number(value.page) >= 1
        && Number.isInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 50
        && Number.isInteger(value.total) && Number(value.total) >= 0
        && Number.isInteger(value.totalPages) && Number(value.totalPages) >= 1
        && value.comments.length <= Number(value.limit)
        && value.comments.every((comment) => isRecord(comment)
            && typeof comment.id === 'string'
            && typeof comment.content === 'string'
            && (comment.parentId === null || typeof comment.parentId === 'string')
            && typeof comment.createdAt === 'string'
            && Number.isFinite(Date.parse(comment.createdAt))
            && isRecord(comment.user)
            && typeof comment.user.id === 'string'
            && Array.isArray(comment.user.channels)
            && comment.user.channels.every((channel) => isRecord(channel)
                && typeof channel.name === 'string'
                && typeof channel.handle === 'string'
                && (channel.avatarUrl === null || typeof channel.avatarUrl === 'string'))
            && isRecord(comment.video)
            && typeof comment.video.id === 'string'
            && typeof comment.video.title === 'string');
}
export function isStudioProfile(value) {
    return isRecord(value)
        && typeof value.email === 'string'
        && Array.isArray(value.channels)
        && value.channels.every((channel) => isRecord(channel)
            && typeof channel.id === 'string'
            && typeof channel.name === 'string'
            && typeof channel.handle === 'string'
            && (channel.description === undefined || channel.description === null || typeof channel.description === 'string')
            && (channel.avatarUrl === undefined || channel.avatarUrl === null || typeof channel.avatarUrl === 'string')
            && (channel.bannerUrl === undefined || channel.bannerUrl === null || typeof channel.bannerUrl === 'string'));
}
function isNonNegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function isNonNegativeInteger(value) {
    return isNonNegativeNumber(value) && Number.isInteger(value);
}
export function isStudioAnalytics(value) {
    return isRecord(value)
        && isRecord(value.period)
        && typeof value.period.from === 'string'
        && Number.isFinite(Date.parse(value.period.from))
        && typeof value.period.to === 'string'
        && Number.isFinite(Date.parse(value.period.to))
        && isNonNegativeInteger(value.subscriberCount)
        && isNonNegativeInteger(value.totalViews)
        && isNonNegativeNumber(value.totalWatchHours)
        && Array.isArray(value.recentPerformance)
        && value.recentPerformance.every((video) => isRecord(video)
            && typeof video.id === 'string'
            && typeof video.title === 'string'
            && isNonNegativeInteger(video.views)
            && isNonNegativeNumber(video.watchHours)
            && isRecord(video._count)
            && isNonNegativeInteger(video._count.likes)
            && isNonNegativeInteger(video._count.comments));
}
export function isStudioWalletBalance(value) {
    return isRecord(value)
        && typeof value.balanceCents === 'string'
        && /^\d+$/.test(value.balanceCents)
        && typeof value.currency === 'string'
        && value.currency.length > 0;
}
export function isStudioLedger(value) {
    return Array.isArray(value)
        && value.every((entry) => isRecord(entry)
            && typeof entry.id === 'string'
            && typeof entry.transactionType === 'string'
            && typeof entry.createdAt === 'string'
            && Number.isFinite(Date.parse(entry.createdAt))
            && typeof entry.amountCents === 'string'
            && /^-?\d+$/.test(entry.amountCents));
}
export function isStudioMonetizationStatus(value) {
    return isRecord(value)
        && typeof value.channelId === 'string'
        && typeof value.channelName === 'string'
        && typeof value.channelHandle === 'string'
        && typeof value.isMonetized === 'boolean'
        && (value.applicationStatus === 'PENDING'
            || value.applicationStatus === 'APPROVED'
            || value.applicationStatus === 'REJECTED'
            || value.applicationStatus === 'NOT_APPLIED')
        && typeof value.canApply === 'boolean'
        && (value.reviewerNotes === null || typeof value.reviewerNotes === 'string')
        && (value.reviewedAt === null
            || (typeof value.reviewedAt === 'string' && Number.isFinite(Date.parse(value.reviewedAt))));
}
