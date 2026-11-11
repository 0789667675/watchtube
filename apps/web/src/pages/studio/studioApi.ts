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
}

export interface StudioMonetizationStatus {
  subscriberCount: number;
  totalWatchHours: number;
  activeStrikes: number;
  isMonetized: boolean;
  applicationStatus: 'PENDING' | 'REJECTED' | 'NOT_APPLIED';
  isEligible: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
