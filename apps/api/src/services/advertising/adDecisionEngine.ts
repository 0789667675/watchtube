import crypto from 'node:crypto';
import {
  AdDecisionRequest,
  AdDecisionResult,
  IAdProviderAdapter,
} from './types';
import { signAdToken } from './adToken';
import {
  AD_DECISION_TIMEOUT_MS,
  AD_TOKEN_TTL_MS,
  resolveAdsTrackingSecret,
} from '../../config/ads';

export interface RegisteredProviderConfig {
  adapter: IAdProviderAdapter;
  priority: number;
  isEnabled: boolean;
  config?: Record<string, unknown>;
}

export interface AdDecisionEngineOptions {
  tokenSecret?: string;
  tokenTtlMs?: number;
  timeoutMs?: number;
}

/**
 * Executes a promise with a hard timeout. If it times out, rejects with an error.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[Timeout] ${operationName} exceeded ${timeoutMs}ms limit.`));
      }, timeoutMs);
      // Ensure timer does not prevent process exit in test environments
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

export class AdDecisionEngine {
  private providers: RegisteredProviderConfig[] = [];
  private tokenSecret: string;
  private tokenTtlMs: number;
  private timeoutMs: number;

  constructor(options: AdDecisionEngineOptions = {}) {
    this.tokenSecret = options.tokenSecret || resolveAdsTrackingSecret();
    this.tokenTtlMs = options.tokenTtlMs || AD_TOKEN_TTL_MS;
    this.timeoutMs = options.timeoutMs || AD_DECISION_TIMEOUT_MS;
  }

  registerProvider(
    adapter: IAdProviderAdapter,
    priority: number = 10,
    isEnabled: boolean = true,
    config?: Record<string, unknown>
  ): this {
    this.providers.push({ adapter, priority, isEnabled, config });
    this.providers.sort((a, b) => a.priority - b.priority);
    return this;
  }

  getProviders(): readonly RegisteredProviderConfig[] {
    return this.providers;
  }

  clearProviders(): void {
    this.providers = [];
  }

  /**
   * Evaluates an ad placement request through the provider waterfall.
   * Guaranteed to FAIL-OPEN: if no ad fills, times out, or an error occurs, it returns
   * a clean NO_FILL response instructing the client to proceed with content playback.
   */
  async decide(request: AdDecisionRequest): Promise<AdDecisionResult> {
    const matchingProviders = this.providers.filter(
      (p) => p.isEnabled && p.adapter.supportedPlacements.includes(request.placement)
    );

    if (matchingProviders.length === 0) {
      return {
        decision: 'NO_FILL',
        placement: request.placement,
        provider: 'none',
        providerType: 'CUSTOM',
        fallbackAction: 'FAIL_OPEN',
        reason: 'No enabled ad provider for this placement',
      };
    }

    for (const item of matchingProviders) {
      try {
        const result = await withTimeout(
          item.adapter.requestAd(request, item.config),
          this.timeoutMs,
          `Provider "${item.adapter.name}"`
        );

        // Validate adapter response structure to protect against malformed data
        if (!result || typeof result !== 'object') {
          continue;
        }

        if (result.decision === 'SERVE') {
          // Verify minimal required payload attributes for serving
          if (!result.format || !result.payload) {
            console.warn(`[AdDecisionEngine] Provider "${item.adapter.name}" returned SERVE without required payload/format.`);
            continue;
          }

          // Generate a cryptographically signed token for tamper-proof telemetry
          const decisionId = crypto.randomUUID();
          const sessionId = request.viewerSessionId?.trim() || decisionId;
          const adId = result.adId || `${item.adapter.id}-${decisionId}`;
          const now = Date.now();

          const token = signAdToken(
            {
              decisionId,
              sessionId,
              placement: request.placement,
              provider: item.adapter.name,
              providerId: item.adapter.id,
              adId,
              videoId: request.videoId,
              channelId: request.channelId,
              isShort: request.isShort,
              v: 2,
              timestamp: now,
              expiresAt: now + this.tokenTtlMs,
            },
            this.tokenSecret
          );

          return {
            ...result,
            decisionId,
            sessionId,
            providerId: item.adapter.id,
            adId,
            trackingToken: token,
          };
        }

        // If provider explicitly returned NO_FILL with TRY_NEXT_PROVIDER, continue waterfall
        if (result.decision === 'NO_FILL') {
          continue;
        }
      } catch (error) {
        // Log provider failure/timeout and try next provider in waterfall
        console.error(`[AdDecisionEngine] Provider "${item.adapter.name}" error:`, error instanceof Error ? error.message : error);
      }
    }

    // If waterfall exhausted with no fill, return FAIL_OPEN
    return {
      decision: 'NO_FILL',
      placement: request.placement,
      provider: 'none',
      providerType: 'CUSTOM',
      fallbackAction: 'FAIL_OPEN',
      reason: 'All providers returned no fill',
    };
  }
}
