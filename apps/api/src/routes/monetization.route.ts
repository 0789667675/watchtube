import express, { Request, RequestHandler, Response, Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db as prisma } from '@watchtube/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/admin';
import {
  AdDecisionEngine,
  AdPlacementType,
  AdTelemetryEventType,
  AttributionPolicyError,
  AttributionValidationError,
  checkContentMonetizationEligibility,
  DirectAdvertiserAdapter,
  IAdTelemetryNonceStore,
  IRedisClientLike,
  isPlaceholderAdUrl,
  resolveAdTelemetryNonceStore,
  RevenueAllocationPolicy,
  RevenueAttributionService,
  VastAdProviderAdapter,
  verifyAdToken,
  verifyAdTokenBinding,
} from '../services/advertising';
import { resolveAdsTrackingSecret } from '../config/ads';

const VALID_PLACEMENTS_SET: ReadonlySet<AdPlacementType> = new Set([
  'PRE_ROLL',
  'MID_ROLL',
  'POST_ROLL',
  'DISPLAY_BANNER',
  'DISPLAY_SIDEBAR',
  'NATIVE_FEED',
]);
const VIDEO_PLACEMENTS_SET: ReadonlySet<AdPlacementType> = new Set([
  'PRE_ROLL',
  'MID_ROLL',
  'POST_ROLL',
]);

const MAX_RATE_LIMIT_ENTRIES = 5000;
const decisionRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const adEventRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function resolveClientIp(req: Request): string {
  if (req.app?.get?.('trust proxy') && req.ip) {
    return req.ip;
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

function isIpRateLimited(
  store: Map<string, { count: number; resetAt: number }>,
  ip: string,
  maxPerMinute: number
): boolean {
  const now = Date.now();
  if (store.size >= MAX_RATE_LIMIT_ENTRIES) {
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
    if (store.size >= MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) {
        store.delete(oldestKey);
      }
    }
  }
  const entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (entry.count >= maxPerMinute) {
    return true;
  }
  entry.count += 1;
  return false;
}

function resolveDbProviderPlacements(prov: {
  supportedPlacements?: unknown;
  format?: unknown;
}): AdPlacementType[] {
  if (Array.isArray(prov.supportedPlacements) && prov.supportedPlacements.length > 0) {
    const valid = prov.supportedPlacements.filter(
      (p): p is AdPlacementType => typeof p === 'string' && VALID_PLACEMENTS_SET.has(p as AdPlacementType)
    );
    if (valid.length > 0) return valid;
  }
  if (typeof prov.format === 'string' && VALID_PLACEMENTS_SET.has(prov.format as AdPlacementType)) {
    return [prov.format as AdPlacementType];
  }
  return ['PRE_ROLL', 'MID_ROLL', 'POST_ROLL'];
}

const adDecisionRequestSchema = z.object({
  placement: z.enum([
    'PRE_ROLL',
    'MID_ROLL',
    'POST_ROLL',
    'DISPLAY_BANNER',
    'DISPLAY_SIDEBAR',
    'NATIVE_FEED',
  ]),
  videoId: z.string().uuid().optional(),
  viewerSessionId: z.string().trim().min(1).max(128).optional(),
  playbackPositionSeconds: z.number().nonnegative().optional(),
});

export interface AdDecisionRouterOptions {
  engine?: AdDecisionEngine;
  prismaClient?: any;
  secret?: string;
  checkEligibility?: typeof checkContentMonetizationEligibility;
}

/**
 * Creates the Ad Decision Router: POST /decision
 */
export function createAdDecisionRouter(options: AdDecisionRouterOptions = {}): Router {
  const router = Router();
  const dbClient = options.prismaClient || prisma;
  const checkEligibility = options.checkEligibility || checkContentMonetizationEligibility;
  const secret = options.secret || resolveAdsTrackingSecret();

  router.post('/decision', async (req: Request, res: Response) => {
    const clientIp = resolveClientIp(req);

    if (isIpRateLimited(decisionRateLimitMap, clientIp, 120)) {
      return res.status(429).json({
        error: 'Too many ad decision requests. Please try again shortly.',
      });
    }

    const parseResult = adDecisionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid ad decision request',
        details: parseResult.error.issues,
      });
    }

    const { placement, videoId, viewerSessionId, playbackPositionSeconds } = parseResult.data;

    if (VIDEO_PLACEMENTS_SET.has(placement) && !videoId) {
      return res.status(200).json({
        decision: 'NO_FILL',
        placement,
        provider: 'none',
        providerType: 'CUSTOM',
        fallbackAction: 'FAIL_OPEN',
        reason: 'Video identifier is required for video ad placements',
      });
    }

    try {
      let channelId: string | undefined;
      let isMonetized = false;
      let isShort = false;

      // 1. Content and creator monetization eligibility validation (inside fail-open try/catch)
      if (videoId) {
        const eligibility = await checkEligibility(videoId, dbClient);

        if (!eligibility.isEligible) {
          // Guaranteed FAIL-OPEN: return a safe NO_FILL response so the video plays without error
          return res.status(200).json({
            decision: 'NO_FILL',
            placement,
            provider: 'none',
            providerType: 'CUSTOM',
            fallbackAction: 'FAIL_OPEN',
            reason: eligibility.reason || 'Content is not eligible for monetization',
          });
        }

        channelId = eligibility.channel?.id;
        isMonetized = eligibility.channel?.isMonetized ?? false;
        isShort = eligibility.video?.isShort ?? false;
      }

      // 2. Resolve providers and execute decision engine
      let engine = options.engine;

      if (!engine) {
        engine = new AdDecisionEngine({ tokenSecret: secret });

        const dbProviders = await dbClient.adProviderConfig.findMany({
          where: { isEnabled: true },
          orderBy: { priority: 'asc' },
        });

        for (const prov of dbProviders) {
          const placements = resolveDbProviderPlacements(prov);
          if (prov.providerType === 'DIRECT') {
            engine.registerProvider(
              new DirectAdvertiserAdapter(prov.id, prov.name),
              prov.priority,
              prov.isEnabled
            );
            continue;
          }
          const adapter = new VastAdProviderAdapter(prov.id, prov.name, {
            supportedPlacements: placements,
          });
          engine.registerProvider(adapter, prov.priority, prov.isEnabled, {
            vastTagUrl: prov.vastTagUrl,
          });
        }
      }

      const clientIpHash = crypto.createHash('sha256').update(clientIp).digest('hex');

      const result = await engine.decide({
        placement: placement as AdPlacementType,
        videoId,
        channelId,
        viewerSessionId,
        isShort,
        isMonetized,
        clientIpHash,
        userAgent: req.headers['user-agent'],
        videoDurationSeconds: playbackPositionSeconds,
      });

      // Record server-side AD_SERVED event distinctly from client impressions/viewability
      if (
        result.decision === 'SERVE'
        && videoId
        && channelId
        && typeof dbClient.adEvent?.create === 'function'
      ) {
        try {
          await dbClient.adEvent.create({
            data: {
              videoId,
              channelId,
              eventType: 'AD_SERVED',
              provider: result.provider,
              grossRevenueCents: BigInt(0),
              ipHash: clientIpHash,
              sessionId: result.sessionId ?? null,
              placement: result.placement,
              adId: result.adId ?? null,
            },
          });
        } catch (telemetryErr) {
          console.error('[AdDecisionRouter] Failed to record server-side AD_SERVED event:', telemetryErr);
        }
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error('[AdDecisionRouter] Decision engine error:', error);
      // Fail-open guarantee: player must never crash or freeze
      return res.status(200).json({
        decision: 'NO_FILL',
        placement,
        provider: 'none',
        providerType: 'CUSTOM',
        fallbackAction: 'FAIL_OPEN',
        reason: 'Ad decision engine temporarily unavailable',
      });
    }
  });

  return router;
}

const adEventSchema = z.object({
  token: z.string().min(10, 'Tracking token is required'),
  eventType: z.enum([
    'AD_REQUEST',
    'AD_LOADED',
    'AD_IMPRESSION',
    'AD_VIEWABLE',
    'AD_CLICK',
    'AD_FIRST_QUARTILE',
    'AD_MIDPOINT',
    'AD_THIRD_QUARTILE',
    'AD_COMPLETED',
    'AD_SKIPPED',
    'AD_ERROR',
  ]),
  playbackTimeSeconds: z.number().nonnegative().optional(),
  errorCode: z.string().max(64).optional(),
  // Optional client binding context assertions (verified strictly against signed token)
  decisionId: z.string().min(1).max(128).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  videoId: z.string().min(1).max(128).optional(),
  channelId: z.string().min(1).max(128).optional(),
  placement: z.enum([
    'PRE_ROLL',
    'MID_ROLL',
    'POST_ROLL',
    'DISPLAY_BANNER',
    'DISPLAY_SIDEBAR',
    'NATIVE_FEED',
  ]).optional(),
  provider: z.string().min(1).max(128).optional(),
  providerId: z.string().min(1).max(128).optional(),
  adId: z.string().min(1).max(256).optional(),
}).strict(); // Strictly reject unauthorized properties (e.g. grossRevenueCents, amount, balances)

export interface AdEventRouterOptions {
  nonceStore?: IAdTelemetryNonceStore;
  redisClient?: IRedisClientLike;
  allowInMemoryNonceStore?: boolean;
  secret?: string;
  prismaClient?: any;
}

/**
 * Creates the Ad Event Ingestion Router: POST /ad-event
 */
export function createAdEventRouter(
  authenticateMiddleware: RequestHandler,
  options: AdEventRouterOptions = {}
): Router {
  const router = Router();
  const nonceStore = resolveAdTelemetryNonceStore({
    nonceStore: options.nonceStore,
    redisClient: options.redisClient,
    allowInMemory: options.allowInMemoryNonceStore,
  });
  const secret = options.secret || resolveAdsTrackingSecret();
  const dbClient = options.prismaClient || prisma;

  router.post('/ad-event', async (req: Request, res: Response) => {
    const clientIp = resolveClientIp(req);
    if (isIpRateLimited(adEventRateLimitMap, clientIp, 300)) {
      return res.status(429).json({
        error: 'Too many ad telemetry requests. Please try again shortly.',
      });
    }

    // Legacy fallback check: if request lacks a token, invoke auth middleware and return 501
    if (!req.body?.token) {
      return authenticateMiddleware(req, res, () => {
        res.status(501).json({ error: 'Ad event verification is not configured' });
      });
    }

    const parsed = adEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid ad telemetry payload. Client-submitted revenue or extra fields are strictly forbidden.',
        details: parsed.error.issues,
      });
    }

    const {
      token,
      eventType,
      playbackTimeSeconds,
      errorCode,
      decisionId,
      sessionId,
      videoId,
      channelId,
      placement,
      provider,
      providerId,
      adId,
    } = parsed.data;

    // 1. Validate cryptographic HMAC-SHA256 token and expiration
    const tokenPayload = verifyAdToken(token, secret);
    if (!tokenPayload) {
      return res.status(400).json({ error: 'Invalid, expired, or tampered ad tracking token' });
    }

    // 2. Enforce strict token binding to decision, session, video, channel, placement, provider, and adId
    const bindingCheck = verifyAdTokenBinding(tokenPayload, {
      decisionId,
      sessionId,
      videoId,
      channelId,
      placement,
      provider,
      providerId,
      adId,
    });
    if (!bindingCheck.valid) {
      return res.status(400).json({
        error: 'Ad tracking token binding mismatch',
        code: 'TOKEN_BINDING_MISMATCH',
        mismatchedFields: bindingCheck.mismatchedFields,
      });
    }

    // Verify token video-to-channel consistency and current eligibility in DB when present
    if (
      tokenPayload.videoId
      && tokenPayload.channelId
      && typeof dbClient.video?.findUnique === 'function'
    ) {
      try {
        const videoRecord = await dbClient.video.findUnique({
          where: { id: tokenPayload.videoId },
          select: {
            id: true,
            status: true,
            visibility: true,
            copyrightReviewStatus: true,
            channel: { select: { id: true, isMonetized: true } },
          },
        });
        if (!videoRecord || (videoRecord.channel?.id && videoRecord.channel.id !== tokenPayload.channelId)) {
          return res.status(400).json({
            error: 'Ad tracking token video/channel binding is invalid',
            code: 'TOKEN_BINDING_MISMATCH',
          });
        }
        if (
          videoRecord.copyrightReviewStatus === 'BLOCKED'
          || (videoRecord.status && videoRecord.status !== 'PUBLISHED' && videoRecord.status !== 'READY')
          || videoRecord.visibility === 'PRIVATE'
          || videoRecord.channel?.isMonetized === false
        ) {
          return res.status(403).json({
            error: 'Content is no longer eligible for ad telemetry',
            code: 'CONTENT_NOT_ELIGIBLE',
          });
        }
      } catch (lookupErr) {
        console.error('[AdEventRouter] Video binding verification failed:', lookupErr);
        return res.status(503).json({
          error: 'Ad telemetry persistence verification is unavailable',
          code: 'PERSISTENCE_UNAVAILABLE',
        });
      }
    }

    // 3. Validate distributed atomic nonce consumption and lifecycle event ordering
    let consumption;
    try {
      consumption = await nonceStore.consumeEvent(
        tokenPayload.sessionId,
        eventType as AdTelemetryEventType,
        tokenPayload.expiresAt
      );
    } catch (storeErr) {
      console.error('[AdEventRouter] Nonce store unavailable:', storeErr);
      return res.status(503).json({
        error: 'Ad telemetry replay verification is temporarily unavailable',
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    }

    if (!consumption.success) {
      if (consumption.reason === 'PERSISTENCE_UNAVAILABLE') {
        return res.status(503).json({
          error: 'Ad telemetry replay verification is temporarily unavailable',
          code: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (consumption.reason === 'SESSION_EXPIRED') {
        return res.status(400).json({
          error: 'Invalid, expired, or tampered ad tracking token',
          code: 'SESSION_EXPIRED',
        });
      }
      if (consumption.isDuplicateImpression) {
        return res.status(409).json({
          error: 'Duplicate impression recorded for this session',
          code: 'DUPLICATE_IMPRESSION',
        });
      }
      return res.status(409).json({
        error: `Event "${eventType}" has already been recorded for this session or violates lifecycle ordering`,
        code: consumption.reason,
      });
    }

    // 4. Persist exact 1:1 lifecycle event type (never collapse distinct lifecycle stages)
    if (tokenPayload.videoId && tokenPayload.channelId) {
      try {
        const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');

        await dbClient.adEvent.create({
          data: {
            videoId: tokenPayload.videoId,
            channelId: tokenPayload.channelId,
            eventType: eventType as AdTelemetryEventType,
            provider: tokenPayload.provider,
            grossRevenueCents: BigInt(0), // NEVER accept client revenue
            ipHash,
            sessionId: tokenPayload.sessionId,
            placement: tokenPayload.placement,
            adId: tokenPayload.adId,
            errorCode: errorCode ?? null,
            playbackTimeSeconds: playbackTimeSeconds ?? null,
          },
        });
      } catch (dbError) {
        console.error('[AdEventRouter] Database persistence error:', dbError);
        if (typeof nonceStore.releaseEvent === 'function') {
          await nonceStore.releaseEvent(tokenPayload.sessionId, eventType as AdTelemetryEventType);
        }
        return res.status(503).json({
          error: 'Ad telemetry persistence failed',
          code: 'PERSISTENCE_ERROR',
        });
      }
    }

    return res.status(200).json({
      success: true,
      recordedEvent: eventType,
      sessionId: tokenPayload.sessionId,
    });
  });

  return router;
}

type AdProviderConfigRecord = Awaited<ReturnType<typeof prisma.adProviderConfig.findMany>>[number];

export function createAdConfigRouter(loadProviders: () => Promise<Partial<AdProviderConfigRecord>[]>): Router {
  const router = Router();

  router.get('/config', async (_req: Request, res: Response) => {
    try {
      const providers = await loadProviders();
      res.status(200).json({
        enabled: providers.length > 0,
        providers,
        adSkipOffsetSeconds: 5,
      });
    } catch (error) {
      console.error('Failed to load monetization config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

export interface RevenueReconciliationRouterOptions {
  attributionService?: RevenueAttributionService;
  allocationPolicy?: RevenueAllocationPolicy | null;
}

const reconcileRequestSchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  reports: z.array(z.record(z.unknown())).min(1),
}).strict();

export function createRevenueReconciliationRouter(
  authenticateMiddleware: RequestHandler,
  requireOwnerMiddleware: RequestHandler,
  options: RevenueReconciliationRouterOptions = {}
): Router {
  const router = Router();

  router.post(
    '/reconcile',
    authenticateMiddleware,
    requireOwnerMiddleware,
    async (req: AuthRequest, res: Response) => {
      if (!options.attributionService || !options.allocationPolicy) {
        return res.status(501).json({
          error: 'Revenue reconciliation is unavailable until verified allocation is configured',
        });
      }

      const parsed = reconcileRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid reconciliation payload. Verified provider reports and YYYY-MM periodMonth are required.',
          details: parsed.error.issues,
        });
      }

      const actorId = req.user?.id;
      const actorRole = req.user?.role || 'SUPER_ADMIN';
      if (!actorId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      try {
        const batch = await options.attributionService.reconcileVerifiedReports({
          periodMonth: parsed.data.periodMonth,
          reports: parsed.data.reports,
          policy: options.allocationPolicy,
          actor: { id: actorId, role: actorRole },
        });

        return res.status(200).json({
          reconciliationId: batch.reconciliationId,
          periodMonth: batch.periodMonth,
          status: batch.status,
          currency: batch.currency,
          appliedCreatorShareBasisPoints: batch.appliedCreatorShareBasisPoints,
          appliedShortsRateBasisPoints: batch.appliedShortsRateBasisPoints,
          totalReportedGrossCents: batch.totalReportedGrossCents.toString(),
          totalProviderFeesCents: batch.totalProviderFeesCents.toString(),
          totalInvalidTrafficDeductionCents: batch.totalInvalidTrafficDeductionCents.toString(),
          totalVerifiedNetRevenueCents: batch.totalVerifiedNetRevenueCents.toString(),
          totalCreatorAttributableCents: batch.totalCreatorAttributableCents.toString(),
          totalPlatformAttributableCents: batch.totalPlatformAttributableCents.toString(),
          totalEscrowWithheldCents: batch.totalEscrowWithheldCents.toString(),
          verifiedLineCount: batch.verifiedLineCount,
          rejectedLineCount: batch.rejectedLineCount,
          duplicateLineCount: batch.duplicateLineCount,
          allocations: batch.allocations.map((a) => ({
            ...a,
            verifiedNetRevenueCents: a.verifiedNetRevenueCents.toString(),
            standardCreatorShareCents: a.standardCreatorShareCents.toString(),
            creatorAttributableCents: a.creatorAttributableCents.toString(),
            platformAttributableCents: a.platformAttributableCents.toString(),
            escrowWithheldCents: a.escrowWithheldCents.toString(),
          })),
          rejectedLines: batch.rejectedLines.map((r) => ({
            ...r,
            reportedGrossRevenueCents: r.reportedGrossRevenueCents.toString(),
            providerFeeCents: r.providerFeeCents.toString(),
            invalidTrafficDeductionCents: r.invalidTrafficDeductionCents.toString(),
            verifiedNetRevenueCents: r.verifiedNetRevenueCents.toString(),
          })),
          finalizedAt: batch.finalizedAt.toISOString(),
        });
      } catch (error) {
        if (error instanceof AttributionPolicyError) {
          return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        if (error instanceof AttributionValidationError) {
          return res.status(error.statusCode).json({ error: error.message, code: error.code });
        }
        console.error('[RevenueReconciliationRouter] Reconciliation failed:', error);
        return res.status(500).json({ error: 'Revenue reconciliation failed.' });
      }
    }
  );

  return router;
}

export interface MonetizationRouterOptions {
  engine?: AdDecisionEngine;
  nonceStore?: IAdTelemetryNonceStore;
  redisClient?: IRedisClientLike;
  allowInMemoryNonceStore?: boolean;
  secret?: string;
  prismaClient?: any;
  authenticateMiddleware?: RequestHandler;
  requireAdminMiddleware?: RequestHandler;
  loadProviders?: () => Promise<Partial<AdProviderConfigRecord>[]>;
  attributionService?: RevenueAttributionService;
  allocationPolicy?: RevenueAllocationPolicy | null;
}

export function createMonetizationRouter(options: MonetizationRouterOptions = {}): Router {
  const router = express.Router();
  const authMiddleware = options.authenticateMiddleware || authenticate;
  // Global revenue reconciliation is strictly owner-only (SUPER_ADMIN) unless explicitly overridden in tests
  const ownerMiddleware = options.requireAdminMiddleware || requireSuperAdmin;

  router.use(
    createAdDecisionRouter({
      engine: options.engine,
      prismaClient: options.prismaClient,
      secret: options.secret,
    })
  );

  router.use(
    createAdEventRouter(authMiddleware, {
      nonceStore: options.nonceStore,
      redisClient: options.redisClient,
      allowInMemoryNonceStore: options.allowInMemoryNonceStore,
      secret: options.secret,
      prismaClient: options.prismaClient,
    })
  );

  router.use(
    createAdConfigRouter(
      options.loadProviders ||
        (async () => {
          const rows = await prisma.adProviderConfig.findMany({
            where: { isEnabled: true },
            orderBy: { priority: 'asc' },
            select: {
              id: true,
              name: true,
              vastTagUrl: true,
              priority: true,
              isEnabled: true,
              format: true,
              providerType: true,
              supportedPlacements: true,
            },
          });
          if (process.env.NODE_ENV === 'test') {
            return rows;
          }
          // Never advertise placeholder URLs (e.g., *.example) as enabled runtime inventory
          return rows.filter(
            (row) => typeof row.vastTagUrl === 'string' && !isPlaceholderAdUrl(row.vastTagUrl)
          );
        })
    )
  );

  router.use(
    createRevenueReconciliationRouter(authMiddleware, ownerMiddleware, {
      attributionService: options.attributionService,
      allocationPolicy: options.allocationPolicy,
    })
  );

  return router;
}

const monetizationRouter = createMonetizationRouter();

export { monetizationRouter };
