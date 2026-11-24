"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdDecisionEngine = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const adToken_1 = require("./adToken");
const ads_1 = require("../../config/ads");
/**
 * Executes a promise with a hard timeout. If it times out, rejects with an error.
 */
function withTimeout(promise, timeoutMs, operationName) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`[Timeout] ${operationName} exceeded ${timeoutMs}ms limit.`));
            }, timeoutMs);
            // Ensure timer does not prevent process exit in test environments
            if (typeof timer.unref === 'function')
                timer.unref();
        }),
    ]);
}
class AdDecisionEngine {
    providers = [];
    tokenSecret;
    tokenTtlMs;
    timeoutMs;
    constructor(options = {}) {
        this.tokenSecret = options.tokenSecret || (0, ads_1.resolveAdsTrackingSecret)();
        this.tokenTtlMs = options.tokenTtlMs || ads_1.AD_TOKEN_TTL_MS;
        this.timeoutMs = options.timeoutMs || ads_1.AD_DECISION_TIMEOUT_MS;
    }
    registerProvider(adapter, priority = 10, isEnabled = true, config) {
        this.providers.push({ adapter, priority, isEnabled, config });
        this.providers.sort((a, b) => a.priority - b.priority);
        return this;
    }
    getProviders() {
        return this.providers;
    }
    clearProviders() {
        this.providers = [];
    }
    /**
     * Evaluates an ad placement request through the provider waterfall.
     * Guaranteed to FAIL-OPEN: if no ad fills, times out, or an error occurs, it returns
     * a clean NO_FILL response instructing the client to proceed with content playback.
     */
    async decide(request) {
        const matchingProviders = this.providers.filter((p) => p.isEnabled && p.adapter.supportedPlacements.includes(request.placement));
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
                const result = await withTimeout(item.adapter.requestAd(request, item.config), this.timeoutMs, `Provider "${item.adapter.name}"`);
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
                    const decisionId = node_crypto_1.default.randomUUID();
                    const sessionId = request.viewerSessionId?.trim() || decisionId;
                    const adId = result.adId || `${item.adapter.id}-${decisionId}`;
                    const now = Date.now();
                    const token = (0, adToken_1.signAdToken)({
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
                    }, this.tokenSecret);
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
            }
            catch (error) {
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
exports.AdDecisionEngine = AdDecisionEngine;
