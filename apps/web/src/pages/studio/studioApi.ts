export interface StudioVideoPerformance {
  id: string;
  title: string;
  viewsCount: number;
  _count: {
    likes: number;
    comments: number;
  };
}

export interface StudioAnalytics {
  subscriberCount: number;
  totalViews: number;
  totalWatchHours: number;
  recentPerformance: StudioVideoPerformance[];
}

export interface StudioWalletBalance {
  balanceCents: string;
  currency: string;
}

export interface StudioLedgerEntry {
  id: string;
  transactionType: string;
  createdAt: string;
  amountCents: string;
  status?: string;
}

export interface StudioMonetizationStatus {
  subscriberCount: number;
  totalWatchHours: number;
  activeStrikes: number;
  isMonetized: boolean;
  applicationStatus: 'PENDING' | 'REJECTED' | 'NOT_APPLIED';
  isEligible: boolean;
}

export interface StudioChannel {
  id: string;
  name: string;
  handle: string;
  description?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
}

export interface StudioChannelSettings {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}

export type StudioChannelImagePurpose = 'avatar' | 'banner';

export const STUDIO_CHANNEL_IMAGE_MAX_FILE_SIZE: Record<StudioChannelImagePurpose, number> = {
  avatar: 5 * 1024 * 1024,
  banner: 10 * 1024 * 1024,
};

export interface StudioChannelImageUploadIntent {
  uploadUrl: string;
  uploadToken: string;
  expiresIn: number;
}

export interface StudioChannelImageConfirmation {
  channel: StudioChannelSettings;
  imageUrl: string;
}

export interface StudioProfile {
  email: string;
  channels: StudioChannel[];
}

export interface StudioOutletContext {
  profile: StudioProfile;
  addChannel: (channel: StudioChannel) => void;
  updateChannel: (channel: StudioChannelSettings) => void;
}

export interface StudioComment {
  id: string;
  content: string;
  parentId: string | null;
  createdAt: string;
  user: {
    id: string;
    channels: Array<{
      name: string;
      handle: string;
      avatarUrl: string | null;
    }>;
  };
  video: {
    id: string;
    title: string;
  };
}

export interface StudioCommentPage {
  comments: StudioComment[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStudioChannelSettings(value: unknown): value is StudioChannelSettings {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.handle === 'string'
    && (value.description === null || typeof value.description === 'string')
    && (value.avatarUrl === null || typeof value.avatarUrl === 'string')
    && (value.bannerUrl === null || typeof value.bannerUrl === 'string');
}

export function isStudioChannelImageUploadIntent(
  value: unknown,
): value is StudioChannelImageUploadIntent {
  if (
    !isRecord(value)
    || typeof value.uploadUrl !== 'string'
    || typeof value.uploadToken !== 'string'
    || value.uploadToken.length === 0
    || value.uploadToken.length > 4096
    || !Number.isInteger(value.expiresIn)
    || Number(value.expiresIn) < 1
    || Number(value.expiresIn) > 900
  ) return false;

  try {
    const url = new URL(value.uploadUrl);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isStudioChannelImageConfirmation(
  value: unknown,
  purpose: StudioChannelImagePurpose,
): value is StudioChannelImageConfirmation {
  if (!isRecord(value) || !isStudioChannelSettings(value.channel) || typeof value.imageUrl !== 'string') {
    return false;
  }
  const savedUrl = purpose === 'avatar' ? value.channel.avatarUrl : value.channel.bannerUrl;
  if (savedUrl !== value.imageUrl) return false;

  try {
    const url = new URL(value.imageUrl);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isStudioCommentPage(value: unknown): value is StudioCommentPage {
  return isRecord(value)
    && Array.isArray(value.comments)
    && Number.isInteger(value.page) && Number(value.page) >= 1
    && Number.isInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 50
    && Number.isInteger(value.total) && Number(value.total) >= 0
    && Number.isInteger(value.totalPages) && Number(value.totalPages) >= 1
    && value.comments.length <= Number(value.limit)
    && value.comments.every((comment: unknown) =>
      isRecord(comment)
      && typeof comment.id === 'string'
      && typeof comment.content === 'string'
      && (comment.parentId === null || typeof comment.parentId === 'string')
      && typeof comment.createdAt === 'string'
      && Number.isFinite(Date.parse(comment.createdAt))
      && isRecord(comment.user)
      && typeof comment.user.id === 'string'
      && Array.isArray(comment.user.channels)
      && comment.user.channels.every((channel: unknown) =>
        isRecord(channel)
        && typeof channel.name === 'string'
        && typeof channel.handle === 'string'
        && (channel.avatarUrl === null || typeof channel.avatarUrl === 'string')
      )
      && isRecord(comment.video)
      && typeof comment.video.id === 'string'
      && typeof comment.video.title === 'string'
    );
}

export function isStudioProfile(value: unknown): value is StudioProfile {
  return isRecord(value)
    && typeof value.email === 'string'
    && Array.isArray(value.channels)
    && value.channels.every((channel: unknown) =>
      isRecord(channel)
      && typeof channel.id === 'string'
      && typeof channel.name === 'string'
      && typeof channel.handle === 'string'
      && (channel.description === undefined || channel.description === null || typeof channel.description === 'string')
      && (channel.avatarUrl === undefined || channel.avatarUrl === null || typeof channel.avatarUrl === 'string')
      && (channel.bannerUrl === undefined || channel.bannerUrl === null || typeof channel.bannerUrl === 'string')
    );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

export function isStudioAnalytics(value: unknown): value is StudioAnalytics {
  return isRecord(value)
    && isNonNegativeInteger(value.subscriberCount)
    && isNonNegativeInteger(value.totalViews)
    && isNonNegativeNumber(value.totalWatchHours)
    && Array.isArray(value.recentPerformance)
    && value.recentPerformance.every((video: unknown) =>
      isRecord(video)
      && typeof video.id === 'string'
      && typeof video.title === 'string'
      && isNonNegativeInteger(video.viewsCount)
      && isRecord(video._count)
      && isNonNegativeInteger(video._count.likes)
      && isNonNegativeInteger(video._count.comments)
    );
}

export function isStudioWalletBalance(value: unknown): value is StudioWalletBalance {
  return isRecord(value)
    && typeof value.balanceCents === 'string'
    && /^\d+$/.test(value.balanceCents)
    && typeof value.currency === 'string'
    && value.currency.length > 0;
}

export function isStudioLedger(value: unknown): value is StudioLedgerEntry[] {
  return Array.isArray(value)
    && value.every((entry: unknown) =>
      isRecord(entry)
      && typeof entry.id === 'string'
      && typeof entry.transactionType === 'string'
      && typeof entry.createdAt === 'string'
      && Number.isFinite(Date.parse(entry.createdAt))
      && typeof entry.amountCents === 'string'
      && /^-?\d+$/.test(entry.amountCents)
    );
}

export function isStudioMonetizationStatus(value: unknown): value is StudioMonetizationStatus {
  return isRecord(value)
    && isNonNegativeInteger(value.subscriberCount)
    && isNonNegativeNumber(value.totalWatchHours)
    && isNonNegativeInteger(value.activeStrikes)
    && typeof value.isMonetized === 'boolean'
    && (value.applicationStatus === 'PENDING'
      || value.applicationStatus === 'REJECTED'
      || value.applicationStatus === 'NOT_APPLIED')
    && typeof value.isEligible === 'boolean';
}
