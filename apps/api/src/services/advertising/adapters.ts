import {
  AdDecisionRequest,
  AdDecisionResult,
  AdPlacementType,
  IAdProviderAdapter,
} from './types';

const PLACEHOLDER_HOST_PATTERNS = [
  /\.example$/i,
  /\.invalid$/i,
  /\.test$/i,
  /\.localhost$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^::1$/,
];

const PLACEHOLDER_TEXT_PATTERN = /(placeholder|replace[_-]?with|your[_-])/i;

export type AdProviderIntegrationState =
  | 'DISABLED'
  | 'PLACEHOLDER_UNVERIFIED'
  | 'IMPLEMENTED_SANDBOX_ONLY'
  | 'IMPLEMENTED_ADAPTER_UNVERIFIED_LIVE';

export function isPlaceholderAdUrl(urlString: string): boolean {
  const trimmed = urlString.trim();
  if (!trimmed || PLACEHOLDER_TEXT_PATTERN.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return PLACEHOLDER_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return true;
  }
}

function isValidHttpUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function inspectAdProviderConfig(config: {
  name?: string;
  vastTagUrl?: string | null;
  providerType?: string | null;
  isEnabled?: boolean;
}): {
  integrationState: AdProviderIntegrationState;
  liveVerified: boolean;
  reason?: string;
} {
  if (config.isEnabled === false) {
    return {
      integrationState: 'DISABLED',
      liveVerified: false,
      reason: 'Provider configuration is disabled.',
    };
  }
  if (config.providerType === 'ADSTERRA' && !config.vastTagUrl) {
    return {
      integrationState: 'IMPLEMENTED_SANDBOX_ONLY',
      liveVerified: false,
      reason: 'Adsterra display adapter emits sandbox HTML comments without live network delivery.',
    };
  }
  if (!config.vastTagUrl || isPlaceholderAdUrl(config.vastTagUrl)) {
    return {
      integrationState: 'PLACEHOLDER_UNVERIFIED',
      liveVerified: false,
      reason: 'Provider URL is a placeholder or non-public host and does not represent live delivery.',
    };
  }
  return {
    integrationState: 'IMPLEMENTED_ADAPTER_UNVERIFIED_LIVE',
    liveVerified: false,
    reason: 'Adapter constructs VAST tag configuration; live third-party fill is reported via verified settlement reports.',
  };
}

export interface VastAdProviderAdapterOptions {
  supportedPlacements?: readonly AdPlacementType[];
  allowPlaceholderUrls?: boolean;
  nodeEnv?: string;
}

/**
 * Generic VAST Adapter.
 * Serves video pre-roll, mid-roll, and post-roll ads via standard IAB VAST XML tags.
 * Rejects placeholder/example domains outside test mode unless explicitly allowed.
 */
export class VastAdProviderAdapter implements IAdProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly providerType = 'VAST_GENERIC' as const;
  readonly supportedPlacements: readonly AdPlacementType[];
  private readonly allowPlaceholderUrls: boolean;

  constructor(
    id: string = 'vast-generic',
    name: string = 'VAST Generic Provider',
    options: VastAdProviderAdapterOptions = {}
  ) {
    this.id = id;
    this.name = name;
    this.supportedPlacements = options.supportedPlacements?.length
      ? options.supportedPlacements
      : ['PRE_ROLL', 'MID_ROLL', 'POST_ROLL'];
    const env = options.nodeEnv ?? process.env.NODE_ENV;
    this.allowPlaceholderUrls = options.allowPlaceholderUrls ?? env === 'test';
  }

  async requestAd(
    request: AdDecisionRequest,
    config?: Record<string, unknown>
  ): Promise<AdDecisionResult | null> {
    if (!this.supportedPlacements.includes(request.placement)) {
      return null;
    }

    const rawUrl = typeof config?.vastTagUrl === 'string' ? config.vastTagUrl.trim() : '';
    if (!rawUrl || !isValidHttpUrl(rawUrl)) {
      return {
        decision: 'NO_FILL',
        placement: request.placement,
        provider: this.name,
        providerType: this.providerType,
        fallbackAction: 'FAIL_OPEN',
        reason: 'No valid HTTP/HTTPS VAST tag URL configured',
      };
    }

    if (!this.allowPlaceholderUrls && isPlaceholderAdUrl(rawUrl)) {
      return {
        decision: 'NO_FILL',
        placement: request.placement,
        provider: this.name,
        providerType: this.providerType,
        fallbackAction: 'FAIL_OPEN',
        reason: 'Placeholder or local VAST tag URL cannot be served as verified live ad inventory',
      };
    }

    // Append macro replacements (cache buster, referrer)
    const cacheBuster = Date.now().toString();
    const resolvedUrl = rawUrl.replace(/\[timestamp\]/gi, cacheBuster);

    const skipOffset = typeof config?.skipOffsetSeconds === 'number' && Number.isFinite(config.skipOffsetSeconds)
      ? Math.max(0, Math.min(30, config.skipOffsetSeconds))
      : 5;

    return {
      decision: 'SERVE',
      placement: request.placement,
      provider: this.name,
      providerType: this.providerType,
      adId: `vast-${this.id}-${cacheBuster}`,
      format: 'VAST_URL',
      payload: {
        vastTagUrl: resolvedUrl,
        skipOffsetSeconds: skipOffset,
      },
      fallbackAction: 'FAIL_OPEN',
    };
  }
}

/**
 * Adsterra Display & Native Adapter.
 * Serves sandbox banner placeholder markup using Adsterra zone configurations.
 * Does NOT constitute live script execution or verified third-party revenue delivery.
 */
export class AdsterraDisplayAdapter implements IAdProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly providerType = 'ADSTERRA' as const;
  readonly integrationState: AdProviderIntegrationState = 'IMPLEMENTED_SANDBOX_ONLY';
  readonly supportedPlacements: readonly AdPlacementType[] = [
    'DISPLAY_BANNER',
    'DISPLAY_SIDEBAR',
    'NATIVE_FEED',
  ];

  constructor(id: string = 'adsterra-display', name: string = 'Adsterra Network') {
    this.id = id;
    this.name = name;
  }

  async requestAd(
    request: AdDecisionRequest,
    config?: Record<string, unknown>
  ): Promise<AdDecisionResult | null> {
    if (!this.supportedPlacements.includes(request.placement)) {
      return null;
    }

    const zoneId = typeof config?.zoneId === 'string' ? config.zoneId.trim() : '';
    // Zone ID must be strictly alphanumeric to prevent unsafe script or HTML injection
    if (!zoneId || !/^[a-zA-Z0-9_-]{1,64}$/.test(zoneId)) {
      return {
        decision: 'NO_FILL',
        placement: request.placement,
        provider: this.name,
        providerType: this.providerType,
        fallbackAction: 'FAIL_OPEN',
        reason: 'Invalid or missing Adsterra zone ID',
      };
    }

    const width = typeof config?.width === 'number' && config.width > 0 ? config.width : 300;
    const height = typeof config?.height === 'number' && config.height > 0 ? config.height : 250;

    return {
      decision: 'SERVE',
      placement: request.placement,
      provider: this.name,
      providerType: this.providerType,
      adId: `adsterra-${zoneId}-${Date.now()}`,
      format: 'HTML_SNIPPET',
      payload: {
        width,
        height,
        htmlSnippet: `<!-- WatchTube Sandboxed Adsterra Zone ${zoneId} -->`,
      },
      fallbackAction: 'FAIL_OPEN',
    };
  }
}

export interface DirectAdvertiserAdapterOptions {
  allowPlaceholderUrls?: boolean;
  nodeEnv?: string;
}

/**
 * Direct Advertiser Adapter.
 * Serves first-party, self-hosted campaigns created by direct advertisers or platform promotions.
 */
export class DirectAdvertiserAdapter implements IAdProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly providerType = 'DIRECT' as const;
  readonly supportedPlacements: readonly AdPlacementType[] = [
    'PRE_ROLL',
    'MID_ROLL',
    'POST_ROLL',
    'DISPLAY_BANNER',
    'DISPLAY_SIDEBAR',
    'NATIVE_FEED',
  ];
  private readonly allowPlaceholderUrls: boolean;

  constructor(
    id: string = 'watchtube-direct',
    name: string = 'WatchTube Direct Campaigns',
    options: DirectAdvertiserAdapterOptions = {}
  ) {
    this.id = id;
    this.name = name;
    const env = options.nodeEnv ?? process.env.NODE_ENV;
    this.allowPlaceholderUrls = options.allowPlaceholderUrls ?? env === 'test';
  }

  async requestAd(
    request: AdDecisionRequest,
    config?: Record<string, unknown>
  ): Promise<AdDecisionResult | null> {
    const directCampaign = config?.campaign as {
      id: string;
      title: string;
      description?: string;
      imageUrl?: string;
      videoUrl?: string;
      targetUrl: string;
      ctaText?: string;
    } | undefined;

    if (!directCampaign || !directCampaign.id || !directCampaign.targetUrl) {
      return {
        decision: 'NO_FILL',
        placement: request.placement,
        provider: this.name,
        providerType: this.providerType,
        fallbackAction: 'FAIL_OPEN',
        reason: 'No active direct campaign matching targeting rules',
      };
    }

    if (
      !isValidHttpUrl(directCampaign.targetUrl)
      || (!this.allowPlaceholderUrls && isPlaceholderAdUrl(directCampaign.targetUrl))
    ) {
      return {
        decision: 'NO_FILL',
        placement: request.placement,
        provider: this.name,
        providerType: this.providerType,
        fallbackAction: 'FAIL_OPEN',
        reason: 'Direct campaign target URL is invalid',
      };
    }

    const isVideo = request.placement === 'PRE_ROLL' || request.placement === 'MID_ROLL' || request.placement === 'POST_ROLL';

    if (
      isVideo
      && directCampaign.videoUrl
      && (!isValidHttpUrl(directCampaign.videoUrl) || (!this.allowPlaceholderUrls && isPlaceholderAdUrl(directCampaign.videoUrl)))
    ) {
      return {
        decision: 'NO_FILL',
        placement: request.placement,
        provider: this.name,
        providerType: this.providerType,
        fallbackAction: 'FAIL_OPEN',
        reason: 'Direct campaign video URL is invalid',
      };
    }

    return {
      decision: 'SERVE',
      placement: request.placement,
      provider: this.name,
      providerType: this.providerType,
      adId: directCampaign.id,
      format: isVideo ? 'DIRECT_VIDEO' : 'IMAGE_BANNER',
      payload: {
        title: directCampaign.title,
        description: directCampaign.description,
        videoUrl: directCampaign.videoUrl,
        imageUrl: directCampaign.imageUrl,
        targetUrl: directCampaign.targetUrl,
        ctaText: directCampaign.ctaText || 'Learn More',
        skipOffsetSeconds: 5,
      },
      fallbackAction: 'FAIL_OPEN',
    };
  }
}
