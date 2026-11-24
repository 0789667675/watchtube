/**
 * WatchTube Advertising Core - Type Definitions & Contracts
 * Provider-independent architecture supporting external networks (Adsterra, Google)
 * and direct platform advertisers.
 */

export type AdPlacementType =
  | 'PRE_ROLL'
  | 'MID_ROLL'
  | 'POST_ROLL'
  | 'DISPLAY_BANNER'
  | 'DISPLAY_SIDEBAR'
  | 'NATIVE_FEED';

export type AdProviderType =
  | 'ADSTERRA'
  | 'GOOGLE_ADSENSE'
  | 'VAST_GENERIC'
  | 'DIRECT'
  | 'CUSTOM';

export type AdCreativeFormat =
  | 'VAST_URL'
  | 'HTML_SNIPPET'
  | 'IMAGE_BANNER'
  | 'DIRECT_VIDEO';

export type AdDecisionOutcome = 'SERVE' | 'NO_FILL' | 'ERROR';

/**
 * Client-reported (signed-token) lifecycle telemetry.
 *
 * IMPORTANT: none of these events is proof that money was earned. Revenue only
 * enters the system through verified provider reports (see revenueAttribution.ts).
 * AD_IMPRESSION (creative began rendering) and AD_VIEWABLE (the
 * player measured the viewability standard) are distinct and must never be merged.
 */
export type AdTelemetryEventType =
  | 'AD_REQUEST'
  | 'AD_LOADED'
  | 'AD_IMPRESSION'
  | 'AD_VIEWABLE'
  | 'AD_CLICK'
  | 'AD_FIRST_QUARTILE'
  | 'AD_MIDPOINT'
  | 'AD_THIRD_QUARTILE'
  | 'AD_COMPLETED'
  | 'AD_SKIPPED'
  | 'AD_ERROR';

export type AdDbEventType = AdTelemetryEventType | 'AD_SERVED';

export interface AdDecisionRequest {
  placement: AdPlacementType;
  videoId?: string;
  channelId?: string;
  viewerUserId?: string;
  viewerSessionId?: string;
  clientIpHash?: string;
  userAgent?: string;
  countryCode?: string;
  videoDurationSeconds?: number;
  isShort?: boolean;
  isMonetized?: boolean;
}

export interface AdCreativePayload {
  vastTagUrl?: string;
  htmlSnippet?: string;
  imageUrl?: string;
  targetUrl?: string;
  videoUrl?: string;
  title?: string;
  description?: string;
  ctaText?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  skipOffsetSeconds?: number;
}

export interface AdDecisionResult {
  decision: AdDecisionOutcome;
  decisionId?: string;
  sessionId?: string;
  placement: AdPlacementType;
  provider: string;
  providerId?: string;
  providerType: AdProviderType;
  adId?: string;
  format?: AdCreativeFormat;
  payload?: AdCreativePayload;
  trackingToken?: string;
  fallbackAction: 'FAIL_OPEN' | 'TRY_NEXT_PROVIDER';
  reason?: string;
}

export interface AdTokenPayload {
  /** Unique per ad decision. */
  decisionId?: string;
  /** Ad playback session identifier bound to the decision. */
  sessionId: string;
  placement: AdPlacementType;
  provider: string;
  /** Stable adapter/provider-config identifier (absent on legacy tokens). */
  providerId?: string;
  adId: string;
  videoId?: string;
  channelId?: string;
  isShort?: boolean;
  /** Token schema version (absent on legacy v1 tokens). */
  v?: number;
  timestamp: number;
  expiresAt: number;
}

export interface AdTokenBindingContext {
  decisionId?: string;
  sessionId?: string;
  placement?: AdPlacementType;
  provider?: string;
  providerId?: string;
  adId?: string;
  videoId?: string;
  channelId?: string;
}

export interface IAdProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly providerType: AdProviderType;
  readonly supportedPlacements: readonly AdPlacementType[];

  requestAd(
    request: AdDecisionRequest,
    config?: Record<string, unknown>
  ): Promise<AdDecisionResult | null>;
}
