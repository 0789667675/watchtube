import crypto from 'node:crypto';
import { db as defaultPrisma } from '@watchtube/database';
import {
  calculateBasisPointsRoundHalfAwayFromZero,
  LEDGER_CURRENCY,
  parseNonNegativeBigIntAmount,
  parsePositiveBigIntAmount,
  WalletLedgerService,
} from '../finance/ledger.service';
import { emitFinancialNotificationEvent } from '../finance/financialEvents';
import { calculateShortsCreatorEarningsRwf } from '../shortsMonetization';
import { recordAuditEvent } from '../audit.service';
import type { AdDbEventType, AdDecisionOutcome, AdPlacementType } from './types';

export class AttributionPolicyError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code = 'ATTRIBUTION_POLICY_UNCONFIGURED', statusCode = 501) {
    super(message);
    this.name = 'AttributionPolicyError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class AttributionValidationError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code = 'ATTRIBUTION_VALIDATION_ERROR', statusCode = 400) {
    super(message);
    this.name = 'AttributionValidationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Explicit 10-Stage Lifecycle & Financial Domain Contracts
// ---------------------------------------------------------------------------

/** Stage 1: Server-side ad decision outcome (never implies revenue). */
export interface AdDecisionLifecycleRecord {
  stage: 'AD_DECISION';
  decisionId: string;
  sessionId: string;
  outcome: AdDecisionOutcome;
  placement: AdPlacementType;
  provider: string;
  videoId?: string;
  channelId?: string;
  isShort?: boolean;
  decidedAt: Date;
}

/** Stage 2: Server-side ad served marker (grossRevenueCents === 0n). */
export interface AdServedLifecycleRecord {
  stage: 'AD_SERVED';
  sessionId: string;
  videoId: string;
  channelId: string;
  provider: string;
  adId?: string;
  recordedAt: Date;
}

/** Stage 3: Client-reported render impression (deduplicated; NOT proof of revenue). */
export interface AdImpressionTelemetryRecord {
  stage: 'IMPRESSION';
  sessionId: string;
  videoId: string;
  channelId: string;
  provider: string;
  recordedAt: Date;
}

/** Stage 4: Client-reported viewable impression (distinct from render impression; NOT proof of revenue). */
export interface AdViewableImpressionTelemetryRecord {
  stage: 'VIEWABLE_IMPRESSION';
  sessionId: string;
  videoId: string;
  channelId: string;
  provider: string;
  recordedAt: Date;
}

/** Stage 5: Client-reported click (distinct from impression/viewable; NOT proof of revenue). */
export interface AdClickTelemetryRecord {
  stage: 'CLICK';
  sessionId: string;
  videoId: string;
  channelId: string;
  provider: string;
  recordedAt: Date;
}

/** Stage 6: External ad-provider settlement report line (the ONLY valid source of gross revenue). */
export interface ProviderRevenueReportLine {
  sourceType: 'PROVIDER_REPORT';
  externalReportId: string;
  provider: string;
  periodMonth: string; // YYYY-MM
  videoId: string;
  channelId: string;
  sessionId?: string;
  reportedGrossRevenueCents: bigint;
  providerFeeCents: bigint;
  invalidTrafficDeductionCents: bigint;
  currency: typeof LEDGER_CURRENCY;
  isInvalidTraffic?: boolean;
  reportedAt: Date;
}

/** Stage 7: Provider report cross-verified against recorded telemetry & content eligibility. */
export interface VerifiedRevenueRecord {
  stage: 'VERIFIED_REVENUE';
  externalReportId: string;
  provider: string;
  periodMonth: string;
  videoId: string;
  channelId: string;
  isShort: boolean;
  hasActiveEscrowHold: boolean;
  verifiedStatus: 'VERIFIED' | 'REJECTED_INVALID_TRAFFIC' | 'REJECTED_UNMATCHED_TELEMETRY' | 'REJECTED_UNELIGIBLE' | 'DUPLICATE_REPORT';
  rejectionReason?: string;
  reportedGrossRevenueCents: bigint;
  providerFeeCents: bigint;
  invalidTrafficDeductionCents: bigint;
  verifiedNetRevenueCents: bigint;
  matchedTelemetryEventIds: string[];
  currency: typeof LEDGER_CURRENCY;
}

/** Stage 9 & 10: Segregated Creator-attributable vs Platform-attributable revenue per verified line. */
export interface RevenueAttributionAllocation {
  externalReportId: string;
  videoId: string;
  channelId: string;
  isShort: boolean;
  verifiedNetRevenueCents: bigint;
  appliedCreatorShareBasisPoints: number;
  appliedShortsRateBasisPoints: number | null;
  standardCreatorShareCents: bigint;
  creatorAttributableCents: bigint;
  platformAttributableCents: bigint;
  escrowWithheldCents: bigint;
  ledgerReferenceId: string;
  currency: typeof LEDGER_CURRENCY;
}

/** Stage 8: Auditable reconciled batch persisted in RevenueReconciliation + WalletTransaction. */
export interface ReconciledRevenueBatch {
  stage: 'RECONCILED_REVENUE';
  reconciliationId: string;
  periodMonth: string;
  status: 'REPORTED' | 'FINALIZED' | 'DISTRIBUTED';
  currency: typeof LEDGER_CURRENCY;
  appliedCreatorShareBasisPoints: number;
  appliedShortsRateBasisPoints: number;
  totalReportedGrossCents: bigint;
  totalProviderFeesCents: bigint;
  totalInvalidTrafficDeductionCents: bigint;
  totalVerifiedNetRevenueCents: bigint;
  totalCreatorAttributableCents: bigint;
  totalPlatformAttributableCents: bigint;
  totalEscrowWithheldCents: bigint;
  verifiedLineCount: number;
  rejectedLineCount: number;
  duplicateLineCount: number;
  allocations: RevenueAttributionAllocation[];
  rejectedLines: VerifiedRevenueRecord[];
  finalizedAt: Date;
}

export interface RevenueAllocationPolicy {
  /**
   * Explicitly approved creator revenue share in integer basis points (0..10,000).
   * Must be explicitly supplied from approved company policy; never defaulted or invented.
   */
  creatorShareBasisPoints: number;
}

export interface RecordedAdEventSnapshot {
  id: string;
  videoId: string;
  channelId: string;
  eventType: AdDbEventType;
  provider: string;
  grossRevenueCents: bigint;
  sessionId?: string | null;
  createdAt: Date;
}

export interface VideoAttributionContext {
  id: string;
  channelId: string;
  isShort: boolean;
  status: string;
  visibility: string;
  copyrightReviewStatus: string;
  channelIsMonetized: boolean;
  hasActiveEscrowHold: boolean;
}

export interface PersistAttributionLineInput {
  provider: string;
  periodMonth: string;
  externalReportId: string;
  videoId: string;
  channelId: string;
  sessionId?: string | null;
  isShort: boolean;
  reportedGrossRevenueCents: bigint;
  providerFeeCents: bigint;
  invalidTrafficDeductionCents: bigint;
  verifiedNetRevenueCents: bigint;
  appliedCreatorShareBps: number;
  appliedShortsRateBps: number | null;
  standardCreatorShareCents: bigint;
  creatorAttributableCents: bigint;
  platformAttributableCents: bigint;
  escrowWithheldCents: bigint;
  ledgerReferenceId: string | null;
  status: 'VERIFIED_CREDITED' | 'VERIFIED_ESCROW_HELD' | 'VERIFIED_ZERO_NET';
}

export interface IRevenueAttributionRepository {
  getShortsRateBasisPoints(): Promise<number | null>;
  findVideoAttributionContext(videoId: string): Promise<VideoAttributionContext | null>;
  findMatchingTelemetryEvents(input: {
    videoId: string;
    channelId: string;
    provider: string;
    sessionId?: string;
  }): Promise<RecordedAdEventSnapshot[]>;
  hasAttributionLine?(
    provider: string,
    periodMonth: string,
    externalReportId: string
  ): Promise<boolean>;
  findAttributionLine?(
    provider: string,
    periodMonth: string,
    externalReportId: string
  ): Promise<{
    id: string;
    channelId: string;
    videoId: string;
    creatorAttributableCents: bigint;
    ledgerReferenceId: string | null;
    status: string;
  } | null>;
  recordAttributionLines?(
    reconciliationId: string,
    lines: PersistAttributionLineInput[]
  ): Promise<{ insertedCount: number; duplicateKeys: string[] }>;
  createReconciliationRecord(input: {
    monthYear: string;
    grossProviderRevenueCents: bigint;
    platformShareCents: bigint;
    creatorPoolCents: bigint;
    status: 'REPORTED' | 'FINALIZED' | 'DISTRIBUTED';
    finalizedAt: Date;
  }): Promise<{ id: string }>;
  updateReconciliationTotals?(
    id: string,
    totals: {
      grossProviderRevenueCents: bigint;
      platformShareCents: bigint;
      creatorPoolCents: bigint;
      status: 'REPORTED' | 'FINALIZED' | 'DISTRIBUTED';
    }
  ): Promise<void>;
  updateReconciliationStatus(
    id: string,
    status: 'REPORTED' | 'FINALIZED' | 'DISTRIBUTED'
  ): Promise<void>;
}

const VALID_TELEMETRY_PROOF_TYPES: ReadonlySet<AdDbEventType> = new Set([
  'AD_SERVED',
  'AD_IMPRESSION',
  'AD_VIEWABLE',
  'AD_CLICK',
]);

/**
 * Validates and normalizes an external provider revenue report input.
 * Strictly rejects client-telemetry payloads or non-integer amounts.
 */
export function validateProviderRevenueReportLine(input: {
  sourceType: unknown;
  externalReportId: unknown;
  provider: unknown;
  periodMonth: unknown;
  videoId: unknown;
  channelId: unknown;
  sessionId?: unknown;
  reportedGrossRevenueCents: unknown;
  providerFeeCents?: unknown;
  invalidTrafficDeductionCents?: unknown;
  currency: unknown;
  isInvalidTraffic?: unknown;
  reportedAt?: unknown;
}): ProviderRevenueReportLine {
  if (input.sourceType !== 'PROVIDER_REPORT') {
    throw new AttributionValidationError(
      'Revenue attribution strictly requires sourceType === "PROVIDER_REPORT". Client telemetry cannot be treated as revenue.',
      'CLIENT_TELEMETRY_CANNOT_PROVE_REVENUE',
      400
    );
  }
  if (typeof input.externalReportId !== 'string' || !input.externalReportId.trim()) {
    throw new AttributionValidationError('externalReportId is required.', 'INVALID_REPORT', 400);
  }
  if (typeof input.provider !== 'string' || !input.provider.trim()) {
    throw new AttributionValidationError('provider is required.', 'INVALID_REPORT', 400);
  }
  if (typeof input.periodMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodMonth)) {
    throw new AttributionValidationError('periodMonth must follow YYYY-MM format.', 'INVALID_PERIOD', 400);
  }
  if (typeof input.videoId !== 'string' || !input.videoId.trim()) {
    throw new AttributionValidationError('videoId is required.', 'INVALID_REPORT', 400);
  }
  if (typeof input.channelId !== 'string' || !input.channelId.trim()) {
    throw new AttributionValidationError('channelId is required.', 'INVALID_REPORT', 400);
  }
  if (input.currency !== LEDGER_CURRENCY) {
    throw new AttributionValidationError(
      `Unsupported currency "${String(input.currency)}". Explicit ${LEDGER_CURRENCY} is required.`,
      'UNSUPPORTED_CURRENCY',
      400
    );
  }

  const reportedGrossRevenueCents = parsePositiveBigIntAmount(
    input.reportedGrossRevenueCents,
    'reportedGrossRevenueCents'
  );
  const providerFeeCents = input.providerFeeCents === undefined
    ? 0n
    : parseNonNegativeBigIntAmount(input.providerFeeCents, 'providerFeeCents');
  const invalidTrafficDeductionCents = input.invalidTrafficDeductionCents === undefined
    ? 0n
    : parseNonNegativeBigIntAmount(input.invalidTrafficDeductionCents, 'invalidTrafficDeductionCents');

  if (providerFeeCents + invalidTrafficDeductionCents > reportedGrossRevenueCents) {
    throw new AttributionValidationError(
      'Provider fees and invalid-traffic deductions cannot exceed reported gross revenue.',
      'NEGATIVE_NET_REVENUE',
      400
    );
  }

  return {
    sourceType: 'PROVIDER_REPORT',
    externalReportId: input.externalReportId.trim(),
    provider: input.provider.trim(),
    periodMonth: input.periodMonth,
    videoId: input.videoId.trim(),
    channelId: input.channelId.trim(),
    ...(typeof input.sessionId === 'string' && input.sessionId.trim()
      ? { sessionId: input.sessionId.trim() }
      : {}),
    reportedGrossRevenueCents,
    providerFeeCents,
    invalidTrafficDeductionCents,
    currency: LEDGER_CURRENCY,
    isInvalidTraffic: input.isInvalidTraffic === true,
    reportedAt: input.reportedAt instanceof Date ? input.reportedAt : new Date(),
  };
}

/**
 * Splits verified net revenue into Creator-attributable and Platform-attributable RWF integer amounts.
 * Enforces explicit approved policy (never invents defaults) and applies prospective Shorts rate cleanly.
 * Guarantees conservation: creatorAttributableCents + platformAttributableCents + escrowWithheldCents === verifiedNetRevenueCents.
 */
export function computeRevenueAllocation(input: {
  verified: VerifiedRevenueRecord;
  policy: RevenueAllocationPolicy;
  shortsRateBasisPoints: number;
}): RevenueAttributionAllocation {
  const { verified, policy, shortsRateBasisPoints } = input;

  if (
    !policy
    || !Number.isInteger(policy.creatorShareBasisPoints)
    || policy.creatorShareBasisPoints < 0
    || policy.creatorShareBasisPoints > 10_000
  ) {
    throw new AttributionPolicyError(
      'Revenue allocation policy is not configured with an approved creatorShareBasisPoints (0..10000).'
    );
  }

  const standardCreatorShareCents = calculateBasisPointsRoundHalfAwayFromZero(
    verified.verifiedNetRevenueCents,
    policy.creatorShareBasisPoints
  );

  const rawCreatorShareCents = verified.isShort
    ? calculateShortsCreatorEarningsRwf(standardCreatorShareCents, shortsRateBasisPoints)
    : standardCreatorShareCents;

  const escrowWithheldCents = verified.hasActiveEscrowHold ? rawCreatorShareCents : 0n;
  const creatorAttributableCents = verified.hasActiveEscrowHold ? 0n : rawCreatorShareCents;
  const platformAttributableCents =
    verified.verifiedNetRevenueCents - creatorAttributableCents - escrowWithheldCents;

  // Deterministic idempotency key per provider report line so retries never double-credit
  const reportHash = crypto
    .createHash('sha256')
    .update(`${verified.provider}:${verified.periodMonth}:${verified.externalReportId}`)
    .digest('hex')
    .slice(0, 24);

  return {
    externalReportId: verified.externalReportId,
    videoId: verified.videoId,
    channelId: verified.channelId,
    isShort: verified.isShort,
    verifiedNetRevenueCents: verified.verifiedNetRevenueCents,
    appliedCreatorShareBasisPoints: policy.creatorShareBasisPoints,
    appliedShortsRateBasisPoints: verified.isShort ? shortsRateBasisPoints : null,
    standardCreatorShareCents,
    creatorAttributableCents,
    platformAttributableCents,
    escrowWithheldCents,
    ledgerReferenceId: `attr:${verified.channelId}:${reportHash}`,
    currency: LEDGER_CURRENCY,
  };
}

export class PrismaRevenueAttributionRepository implements IRevenueAttributionRepository {
  constructor(private readonly prismaClient: any = defaultPrisma) {}

  async getShortsRateBasisPoints(): Promise<number | null> {
    if (typeof this.prismaClient.$queryRaw === 'function') {
      const rows = await this.prismaClient.$queryRaw`
        SELECT "rateBasisPoints" FROM "ShortsMonetizationSetting" WHERE "id" = 'global'
      `;
      if (Array.isArray(rows) && rows[0] && typeof rows[0].rateBasisPoints === 'number') {
        return rows[0].rateBasisPoints;
      }
    }
    if (typeof this.prismaClient.shortsMonetizationSetting?.findUnique === 'function') {
      const row = await this.prismaClient.shortsMonetizationSetting.findUnique({
        where: { id: 'global' },
        select: { rateBasisPoints: true },
      });
      return row?.rateBasisPoints ?? null;
    }
    return null;
  }

  async findVideoAttributionContext(videoId: string): Promise<VideoAttributionContext | null> {
    const video = await this.prismaClient.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        channelId: true,
        isShort: true,
        status: true,
        visibility: true,
        copyrightReviewStatus: true,
        channel: { select: { isMonetized: true } },
        escrowHolds: {
          where: { status: 'HELD' },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!video) return null;
    return {
      id: video.id,
      channelId: video.channelId,
      isShort: Boolean(video.isShort),
      status: video.status,
      visibility: video.visibility,
      copyrightReviewStatus: video.copyrightReviewStatus,
      channelIsMonetized: Boolean(video.channel?.isMonetized),
      hasActiveEscrowHold: Array.isArray(video.escrowHolds) && video.escrowHolds.length > 0,
    };
  }

  async findMatchingTelemetryEvents(input: {
    videoId: string;
    channelId: string;
    provider: string;
    sessionId?: string;
  }): Promise<RecordedAdEventSnapshot[]> {
    return this.prismaClient.adEvent.findMany({
      where: {
        videoId: input.videoId,
        channelId: input.channelId,
        provider: input.provider,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAttributionLine(
    provider: string,
    periodMonth: string,
    externalReportId: string
  ) {
    return this.prismaClient.adRevenueAttributionLine.findUnique({
      where: {
        provider_periodMonth_externalReportId: {
          provider,
          periodMonth,
          externalReportId,
        },
      },
      select: {
        id: true,
        channelId: true,
        videoId: true,
        creatorAttributableCents: true,
        ledgerReferenceId: true,
        status: true,
      },
    });
  }

  async hasAttributionLine(
    provider: string,
    periodMonth: string,
    externalReportId: string
  ): Promise<boolean> {
    const existing = await this.prismaClient.adRevenueAttributionLine.findUnique({
      where: {
        provider_periodMonth_externalReportId: {
          provider,
          periodMonth,
          externalReportId,
        },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  async recordAttributionLines(
    reconciliationId: string,
    lines: PersistAttributionLineInput[]
  ): Promise<{ insertedCount: number; duplicateKeys: string[] }> {
    let insertedCount = 0;
    const duplicateKeys: string[] = [];

    for (const line of lines) {
      try {
        await this.prismaClient.adRevenueAttributionLine.create({
          data: {
            reconciliationId,
            provider: line.provider,
            periodMonth: line.periodMonth,
            externalReportId: line.externalReportId,
            videoId: line.videoId,
            channelId: line.channelId,
            sessionId: line.sessionId ?? null,
            isShort: line.isShort,
            reportedGrossRevenueCents: line.reportedGrossRevenueCents,
            providerFeeCents: line.providerFeeCents,
            invalidTrafficDeductionCents: line.invalidTrafficDeductionCents,
            verifiedNetRevenueCents: line.verifiedNetRevenueCents,
            appliedCreatorShareBps: line.appliedCreatorShareBps,
            appliedShortsRateBps: line.appliedShortsRateBps,
            standardCreatorShareCents: line.standardCreatorShareCents,
            creatorAttributableCents: line.creatorAttributableCents,
            platformAttributableCents: line.platformAttributableCents,
            escrowWithheldCents: line.escrowWithheldCents,
            ledgerReferenceId: line.ledgerReferenceId,
            status: line.status,
          },
        });
        insertedCount += 1;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          duplicateKeys.push(`${line.provider}::${line.periodMonth}::${line.externalReportId}`);
          continue;
        }
        throw err;
      }
    }

    return { insertedCount, duplicateKeys };
  }

  async createReconciliationRecord(input: {
    monthYear: string;
    grossProviderRevenueCents: bigint;
    platformShareCents: bigint;
    creatorPoolCents: bigint;
    status: 'REPORTED' | 'FINALIZED' | 'DISTRIBUTED';
    finalizedAt: Date;
  }): Promise<{ id: string }> {
    return this.prismaClient.revenueReconciliation.create({
      data: input,
      select: { id: true },
    });
  }

  async updateReconciliationTotals(
    id: string,
    totals: {
      grossProviderRevenueCents: bigint;
      platformShareCents: bigint;
      creatorPoolCents: bigint;
      status: 'REPORTED' | 'FINALIZED' | 'DISTRIBUTED';
    }
  ): Promise<void> {
    await this.prismaClient.revenueReconciliation.update({
      where: { id },
      data: totals,
    });
  }

  async updateReconciliationStatus(
    id: string,
    status: 'REPORTED' | 'FINALIZED' | 'DISTRIBUTED'
  ): Promise<void> {
    await this.prismaClient.revenueReconciliation.update({
      where: { id },
      data: { status },
    });
  }
}

export class RevenueAttributionService {
  private readonly periodLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: IRevenueAttributionRepository,
    private readonly ledger: WalletLedgerService,
    private readonly auditRecorder: typeof recordAuditEvent = recordAuditEvent
  ) {}

  private async withPeriodLock<T>(periodMonth: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.periodLocks.get(periodMonth) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.periodLocks.set(periodMonth, prev.then(() => gate));

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Reconciles verified external provider reports against recorded telemetry and eligibility,
   * splits creator vs platform share under an explicitly approved policy, applies the prospective
   * Shorts rate snapshot, and credits creator wallets idempotently.
   */
  async reconcileVerifiedReports(input: {
    periodMonth: string;
    reports: unknown[];
    policy: RevenueAllocationPolicy | null | undefined;
    actor: { id: string; role: string };
  }): Promise<ReconciledRevenueBatch> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodMonth)) {
      throw new AttributionValidationError('periodMonth must follow YYYY-MM format.', 'INVALID_PERIOD', 400);
    }

    if (
      !input.policy
      || !Number.isInteger(input.policy.creatorShareBasisPoints)
      || input.policy.creatorShareBasisPoints < 0
      || input.policy.creatorShareBasisPoints > 10_000
    ) {
      throw new AttributionPolicyError(
        'Revenue reconciliation is unavailable until an approved revenue allocation policy is configured.'
      );
    }

    if (!Array.isArray(input.reports) || input.reports.length === 0) {
      throw new AttributionValidationError(
        'At least one verified provider report is required. Missing provider reports cannot be fabricated.',
        'MISSING_PROVIDER_REPORTS',
        400
      );
    }

    // Pre-validate every report line up front so malformed batches never partially credit wallets
    const validatedReports = input.reports.map((rawReport) => {
      const report = validateProviderRevenueReportLine(rawReport as any);
      if (report.periodMonth !== input.periodMonth) {
        throw new AttributionValidationError(
          `Report "${report.externalReportId}" belongs to "${report.periodMonth}", expected "${input.periodMonth}".`,
          'PERIOD_MISMATCH',
          400
        );
      }
      return report;
    });

    return this.withPeriodLock(input.periodMonth, () =>
      this.executeValidatedBatchReconciliation({
        periodMonth: input.periodMonth,
        validatedReports,
        policy: input.policy!,
        actor: input.actor,
      })
    );
  }

  private async executeValidatedBatchReconciliation(input: {
    periodMonth: string;
    validatedReports: ProviderRevenueReportLine[];
    policy: RevenueAllocationPolicy;
    actor: { id: string; role: string };
  }): Promise<ReconciledRevenueBatch> {
    const shortsRateBasisPoints = await this.repo.getShortsRateBasisPoints();
    if (shortsRateBasisPoints === null) {
      throw new AttributionPolicyError(
        'Shorts monetization rate setting is unavailable in persistence; failing closed.',
        'SHORTS_SETTING_UNAVAILABLE',
        503
      );
    }

    const seenExternalIds = new Set<string>();
    let allocations: RevenueAttributionAllocation[] = [];
    const pendingPersistLines: PersistAttributionLineInput[] = [];
    const pendingVerifiedByKey = new Map<string, VerifiedRevenueRecord>();
    const rejectedLines: VerifiedRevenueRecord[] = [];
    let duplicateLineCount = 0;

    let totalReportedGrossCents = 0n;
    let totalProviderFeesCents = 0n;
    let totalInvalidTrafficDeductionCents = 0n;
    let totalVerifiedNetRevenueCents = 0n;
    let totalCreatorAttributableCents = 0n;
    let totalPlatformAttributableCents = 0n;
    let totalEscrowWithheldCents = 0n;

    for (const report of input.validatedReports) {

      const dedupKey = `${report.provider}::${report.periodMonth}::${report.externalReportId}`;
      if (seenExternalIds.has(dedupKey)) {
        duplicateLineCount += 1;
        rejectedLines.push({
          stage: 'VERIFIED_REVENUE',
          externalReportId: report.externalReportId,
          provider: report.provider,
          periodMonth: report.periodMonth,
          videoId: report.videoId,
          channelId: report.channelId,
          isShort: false,
          hasActiveEscrowHold: false,
          verifiedStatus: 'DUPLICATE_REPORT',
          rejectionReason: 'Duplicate externalReportId inside reconciliation batch',
          reportedGrossRevenueCents: report.reportedGrossRevenueCents,
          providerFeeCents: report.providerFeeCents,
          invalidTrafficDeductionCents: report.invalidTrafficDeductionCents,
          verifiedNetRevenueCents: 0n,
          matchedTelemetryEventIds: [],
          currency: LEDGER_CURRENCY,
        });
        continue;
      }
      seenExternalIds.add(dedupKey);

      if (
        typeof this.repo.hasAttributionLine === 'function'
        && (await this.repo.hasAttributionLine(report.provider, report.periodMonth, report.externalReportId))
      ) {
        duplicateLineCount += 1;
        rejectedLines.push({
          stage: 'VERIFIED_REVENUE',
          externalReportId: report.externalReportId,
          provider: report.provider,
          periodMonth: report.periodMonth,
          videoId: report.videoId,
          channelId: report.channelId,
          isShort: false,
          hasActiveEscrowHold: false,
          verifiedStatus: 'DUPLICATE_REPORT',
          rejectionReason: 'Attribution line already reconciled and persisted',
          reportedGrossRevenueCents: report.reportedGrossRevenueCents,
          providerFeeCents: report.providerFeeCents,
          invalidTrafficDeductionCents: report.invalidTrafficDeductionCents,
          verifiedNetRevenueCents: 0n,
          matchedTelemetryEventIds: [],
          currency: LEDGER_CURRENCY,
        });
        continue;
      }

      const videoCtx = await this.repo.findVideoAttributionContext(report.videoId);
      if (
        !videoCtx
        || videoCtx.channelId !== report.channelId
        || !videoCtx.channelIsMonetized
        || (videoCtx.status !== 'PUBLISHED' && videoCtx.status !== 'READY')
        || (videoCtx.visibility !== 'PUBLIC' && videoCtx.visibility !== 'UNLISTED')
        || videoCtx.copyrightReviewStatus === 'BLOCKED'
      ) {
        rejectedLines.push({
          stage: 'VERIFIED_REVENUE',
          externalReportId: report.externalReportId,
          provider: report.provider,
          periodMonth: report.periodMonth,
          videoId: report.videoId,
          channelId: report.channelId,
          isShort: videoCtx?.isShort ?? false,
          hasActiveEscrowHold: videoCtx?.hasActiveEscrowHold ?? false,
          verifiedStatus: 'REJECTED_UNELIGIBLE',
          rejectionReason: 'Video or channel is missing, mismatched, copyright-blocked, or not monetized',
          reportedGrossRevenueCents: report.reportedGrossRevenueCents,
          providerFeeCents: report.providerFeeCents,
          invalidTrafficDeductionCents: report.invalidTrafficDeductionCents,
          verifiedNetRevenueCents: 0n,
          matchedTelemetryEventIds: [],
          currency: LEDGER_CURRENCY,
        });
        continue;
      }

      if (report.isInvalidTraffic) {
        rejectedLines.push({
          stage: 'VERIFIED_REVENUE',
          externalReportId: report.externalReportId,
          provider: report.provider,
          periodMonth: report.periodMonth,
          videoId: report.videoId,
          channelId: report.channelId,
          isShort: videoCtx.isShort,
          hasActiveEscrowHold: videoCtx.hasActiveEscrowHold,
          verifiedStatus: 'REJECTED_INVALID_TRAFFIC',
          rejectionReason: 'Provider report flagged traffic as invalid',
          reportedGrossRevenueCents: report.reportedGrossRevenueCents,
          providerFeeCents: report.providerFeeCents,
          invalidTrafficDeductionCents: report.invalidTrafficDeductionCents,
          verifiedNetRevenueCents: 0n,
          matchedTelemetryEventIds: [],
          currency: LEDGER_CURRENCY,
        });
        continue;
      }

      const telemetry = await this.repo.findMatchingTelemetryEvents({
        videoId: report.videoId,
        channelId: report.channelId,
        provider: report.provider,
        sessionId: report.sessionId,
      });

      const hasSessionError = report.sessionId
        ? telemetry.some((ev) => ev.eventType === 'AD_ERROR')
        : false;
      const validProofEvents = telemetry.filter((ev) => VALID_TELEMETRY_PROOF_TYPES.has(ev.eventType));

      if (hasSessionError || validProofEvents.length === 0) {
        rejectedLines.push({
          stage: 'VERIFIED_REVENUE',
          externalReportId: report.externalReportId,
          provider: report.provider,
          periodMonth: report.periodMonth,
          videoId: report.videoId,
          channelId: report.channelId,
          isShort: videoCtx.isShort,
          hasActiveEscrowHold: videoCtx.hasActiveEscrowHold,
          verifiedStatus: hasSessionError ? 'REJECTED_INVALID_TRAFFIC' : 'REJECTED_UNMATCHED_TELEMETRY',
          rejectionReason: hasSessionError
            ? 'Session recorded AD_ERROR; failed ad sessions cannot earn revenue'
            : 'No verified WatchTube delivery/impression telemetry matches this provider report',
          reportedGrossRevenueCents: report.reportedGrossRevenueCents,
          providerFeeCents: report.providerFeeCents,
          invalidTrafficDeductionCents: report.invalidTrafficDeductionCents,
          verifiedNetRevenueCents: 0n,
          matchedTelemetryEventIds: [],
          currency: LEDGER_CURRENCY,
        });
        continue;
      }

      const verifiedNetRevenueCents =
        report.reportedGrossRevenueCents - report.providerFeeCents - report.invalidTrafficDeductionCents;

      const verified: VerifiedRevenueRecord = {
        stage: 'VERIFIED_REVENUE',
        externalReportId: report.externalReportId,
        provider: report.provider,
        periodMonth: report.periodMonth,
        videoId: report.videoId,
        channelId: report.channelId,
        isShort: videoCtx.isShort,
        hasActiveEscrowHold: videoCtx.hasActiveEscrowHold,
        verifiedStatus: 'VERIFIED',
        reportedGrossRevenueCents: report.reportedGrossRevenueCents,
        providerFeeCents: report.providerFeeCents,
        invalidTrafficDeductionCents: report.invalidTrafficDeductionCents,
        verifiedNetRevenueCents,
        matchedTelemetryEventIds: validProofEvents.map((e) => e.id),
        currency: LEDGER_CURRENCY,
      };

      const allocation = computeRevenueAllocation({
        verified,
        policy: input.policy,
        shortsRateBasisPoints,
      });

      if (allocation.creatorAttributableCents > 0n) {
        const creditResult = await this.ledger.creditRevenue({
          channelId: allocation.channelId,
          amountCents: allocation.creatorAttributableCents,
          referenceId: allocation.ledgerReferenceId,
          status: 'AVAILABLE',
        });
        if (creditResult.duplicate) {
          duplicateLineCount += 1;
          rejectedLines.push({
            ...verified,
            verifiedStatus: 'DUPLICATE_REPORT',
            rejectionReason: 'Attribution already credited to wallet ledger',
            verifiedNetRevenueCents: 0n,
          });
          continue;
        }
      }

      totalReportedGrossCents += report.reportedGrossRevenueCents;
      totalProviderFeesCents += report.providerFeeCents;
      totalInvalidTrafficDeductionCents += report.invalidTrafficDeductionCents;
      totalVerifiedNetRevenueCents += verifiedNetRevenueCents;
      totalCreatorAttributableCents += allocation.creatorAttributableCents;
      totalPlatformAttributableCents += allocation.platformAttributableCents;
      totalEscrowWithheldCents += allocation.escrowWithheldCents;

      allocations.push(allocation);
      pendingVerifiedByKey.set(dedupKey, verified);
      pendingPersistLines.push({
        provider: report.provider,
        periodMonth: report.periodMonth,
        externalReportId: report.externalReportId,
        videoId: report.videoId,
        channelId: report.channelId,
        sessionId: report.sessionId ?? null,
        isShort: verified.isShort,
        reportedGrossRevenueCents: report.reportedGrossRevenueCents,
        providerFeeCents: report.providerFeeCents,
        invalidTrafficDeductionCents: report.invalidTrafficDeductionCents,
        verifiedNetRevenueCents,
        appliedCreatorShareBps: allocation.appliedCreatorShareBasisPoints,
        appliedShortsRateBps: allocation.appliedShortsRateBasisPoints,
        standardCreatorShareCents: allocation.standardCreatorShareCents,
        creatorAttributableCents: allocation.creatorAttributableCents,
        platformAttributableCents: allocation.platformAttributableCents,
        escrowWithheldCents: allocation.escrowWithheldCents,
        ledgerReferenceId: allocation.creatorAttributableCents > 0n ? allocation.ledgerReferenceId : null,
        status:
          allocation.escrowWithheldCents > 0n
            ? 'VERIFIED_ESCROW_HELD'
            : allocation.creatorAttributableCents > 0n
              ? 'VERIFIED_CREDITED'
              : 'VERIFIED_ZERO_NET',
      });
    }

    const finalizedAt = new Date();
    const reconRecord = await this.repo.createReconciliationRecord({
      monthYear: input.periodMonth,
      grossProviderRevenueCents: totalReportedGrossCents,
      platformShareCents: totalPlatformAttributableCents,
      creatorPoolCents: totalCreatorAttributableCents,
      status: allocations.length > 0 ? 'DISTRIBUTED' : 'FINALIZED',
      finalizedAt,
    });

    if (pendingPersistLines.length > 0 && typeof this.repo.recordAttributionLines === 'function') {
      const persistRes = await this.repo.recordAttributionLines(reconRecord.id, pendingPersistLines);
      if (persistRes.duplicateKeys.length > 0) {
        const dupSet = new Set(persistRes.duplicateKeys);
        const dupExternalIds = new Set<string>();
        totalReportedGrossCents = 0n;
        totalProviderFeesCents = 0n;
        totalInvalidTrafficDeductionCents = 0n;
        totalVerifiedNetRevenueCents = 0n;
        totalCreatorAttributableCents = 0n;
        totalPlatformAttributableCents = 0n;
        totalEscrowWithheldCents = 0n;

        for (const line of pendingPersistLines) {
          const lineKey = `${line.provider}::${line.periodMonth}::${line.externalReportId}`;
          const verifiedItem = pendingVerifiedByKey.get(lineKey)!;
          if (dupSet.has(lineKey)) {
            dupExternalIds.add(line.externalReportId);
            duplicateLineCount += 1;
            rejectedLines.push({
              ...verifiedItem,
              verifiedStatus: 'DUPLICATE_REPORT',
              rejectionReason: 'Attribution line already reconciled concurrently',
              verifiedNetRevenueCents: 0n,
            });
            continue;
          }
          totalReportedGrossCents += line.reportedGrossRevenueCents;
          totalProviderFeesCents += line.providerFeeCents;
          totalInvalidTrafficDeductionCents += line.invalidTrafficDeductionCents;
          totalVerifiedNetRevenueCents += line.verifiedNetRevenueCents;
          totalCreatorAttributableCents += line.creatorAttributableCents;
          totalPlatformAttributableCents += line.platformAttributableCents;
          totalEscrowWithheldCents += line.escrowWithheldCents;
        }
        allocations = allocations.filter((a) => !dupExternalIds.has(a.externalReportId));
        if (typeof this.repo.updateReconciliationTotals === 'function') {
          await this.repo.updateReconciliationTotals(reconRecord.id, {
            grossProviderRevenueCents: totalReportedGrossCents,
            platformShareCents: totalPlatformAttributableCents,
            creatorPoolCents: totalCreatorAttributableCents,
            status: allocations.length > 0 ? 'DISTRIBUTED' : 'FINALIZED',
          });
        }
      }
    }

    await this.auditRecorder({
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: 'REVENUE_RECONCILED',
      targetResource: 'REVENUE_RECONCILIATION',
      targetId: reconRecord.id,
      outcome: 'SUCCESS',
      metadata: {
        periodMonth: input.periodMonth,
        appliedCreatorShareBasisPoints: input.policy.creatorShareBasisPoints,
        appliedShortsRateBasisPoints: shortsRateBasisPoints,
        verifiedLineCount: allocations.length,
        rejectedLineCount: rejectedLines.length,
        duplicateLineCount,
        totalVerifiedNetRevenueCents: totalVerifiedNetRevenueCents.toString(),
        totalCreatorAttributableCents: totalCreatorAttributableCents.toString(),
        totalPlatformAttributableCents: totalPlatformAttributableCents.toString(),
        totalEscrowWithheldCents: totalEscrowWithheldCents.toString(),
      },
    });

    for (const allocation of allocations) {
      if (allocation.creatorAttributableCents > 0n) {
        void emitFinancialNotificationEvent({
          eventId: crypto.randomUUID(),
          eventType: 'REVENUE_ATTRIBUTED',
          attributionLineId: allocation.ledgerReferenceId,
          reportId: allocation.externalReportId,
          channelId: allocation.channelId,
          amountCents: allocation.creatorAttributableCents,
          currency: LEDGER_CURRENCY,
          provider: 'WATCHTUBE_ADS',
          timestamp: finalizedAt,
        });
      }
    }

    return {
      stage: 'RECONCILED_REVENUE',
      reconciliationId: reconRecord.id,
      periodMonth: input.periodMonth,
      status: allocations.length > 0 ? 'DISTRIBUTED' : 'FINALIZED',
      currency: LEDGER_CURRENCY,
      appliedCreatorShareBasisPoints: input.policy.creatorShareBasisPoints,
      appliedShortsRateBasisPoints: shortsRateBasisPoints,
      totalReportedGrossCents,
      totalProviderFeesCents,
      totalInvalidTrafficDeductionCents,
      totalVerifiedNetRevenueCents,
      totalCreatorAttributableCents,
      totalPlatformAttributableCents,
      totalEscrowWithheldCents,
      verifiedLineCount: allocations.length,
      rejectedLineCount: rejectedLines.length,
      duplicateLineCount,
      allocations,
      rejectedLines,
      finalizedAt,
    };
  }

  /**
   * Records a verified post-settlement invalid-traffic clawback / provider reversal
   * against an existing attributed report line without fabricating deductions or
   * mutating historical ledger rows. Idempotent via deterministic referenceId.
   */
  async reverseAttributedReportLine(input: {
    sourceType: 'PROVIDER_ADJUSTMENT' | 'PROVIDER_REPORT';
    provider: string;
    periodMonth: string;
    externalReportId: string;
    clawbackCents: unknown;
    reason: string;
    actor: { id: string; role: string };
    allowNegativeBalance?: boolean;
  }): Promise<{
    referenceId: string;
    channelId: string;
    clawbackCents: bigint;
    duplicate: boolean;
  }> {
    if (input.sourceType !== 'PROVIDER_ADJUSTMENT' && input.sourceType !== 'PROVIDER_REPORT') {
      throw new AttributionValidationError(
        'Verified provider adjustment report is required for attribution reversal.',
        'INVALID_ADJUSTMENT_SOURCE',
        400
      );
    }
    const provider = input.provider.trim();
    const externalReportId = input.externalReportId.trim();
    const reason = input.reason.trim();
    if (!provider || !externalReportId || !reason) {
      throw new AttributionValidationError('provider, externalReportId, and reason are required.', 'INVALID_REPORT', 400);
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodMonth)) {
      throw new AttributionValidationError('periodMonth must follow YYYY-MM format.', 'INVALID_PERIOD', 400);
    }

    const clawbackCents = parsePositiveBigIntAmount(input.clawbackCents, 'clawbackCents');
    if (typeof this.repo.findAttributionLine !== 'function') {
      throw new AttributionPolicyError('Attribution line lookup is unavailable for clawback verification.', 'UNSUPPORTED_OPERATION', 501);
    }

    const originalLine = await this.repo.findAttributionLine(provider, input.periodMonth, externalReportId);
    if (!originalLine || originalLine.status !== 'VERIFIED_CREDITED' || originalLine.creatorAttributableCents <= 0n) {
      throw new AttributionValidationError(
        'No credited attribution line exists for the specified provider report.',
        'ATTRIBUTION_LINE_NOT_FOUND',
        404
      );
    }
    if (clawbackCents > originalLine.creatorAttributableCents) {
      throw new AttributionValidationError(
        'Verified clawback amount cannot exceed original creator attribution.',
        'CLAWBACK_EXCEEDS_ATTRIBUTED_AMOUNT',
        400
      );
    }

    const reportHash = crypto
      .createHash('sha256')
      .update(`${provider}:${input.periodMonth}:${externalReportId}`)
      .digest('hex')
      .slice(0, 24);
    const referenceId = `clawback:${originalLine.channelId}:${reportHash}`;

    const result = await this.ledger.recordAdjustmentOrReversal({
      channelId: originalLine.channelId,
      referenceId,
      deltaCents: -clawbackCents,
      status: 'AVAILABLE',
      allowNegativeBalance: input.allowNegativeBalance,
    });

    if (!result.duplicate) {
      await this.auditRecorder({
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: 'ATTRIBUTION_CLAWBACK_RECORDED',
        targetResource: 'REVENUE_ATTRIBUTION',
        targetId: originalLine.id,
        outcome: 'SUCCESS',
        metadata: {
          provider,
          periodMonth: input.periodMonth,
          externalReportId,
          channelId: originalLine.channelId,
          clawbackCents: clawbackCents.toString(),
          reason,
        },
      });
    }

    return {
      referenceId,
      channelId: originalLine.channelId,
      clawbackCents,
      duplicate: result.duplicate,
    };
  }
}
