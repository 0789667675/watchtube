import { db as defaultPrisma } from '@watchtube/database';

export interface ContentMonetizationEligibility {
  isEligible: boolean;
  reason?: string;
  video?: {
    id: string;
    channelId: string;
    title: string;
    isShort: boolean;
    durationSeconds?: number;
  };
  channel?: {
    id: string;
    isMonetized: boolean;
  };
}

export interface EligibilityPrismaClient {
  video: {
    findUnique(args: any): Promise<any>;
  };
  userStrike?: {
    findFirst(args: any): Promise<any>;
  };
}

/**
 * Validates content and creator eligibility for ad delivery.
 *
 * Requirements:
 * 1. Video must exist, be in PUBLISHED/READY status, and PUBLIC/UNLISTED visibility.
 * 2. Video must not be BLOCKED by copyright.
 * 3. Creator Channel must be enrolled and approved in WTPP (isMonetized = true).
 * 4. Creator User account must not be RESTRICTED or SUSPENDED.
 * 5. Creator must not have an active UserStrike of type MONETIZATION_HOLD or SUSPENSION.
 */
export async function checkContentMonetizationEligibility(
  videoId: string,
  prismaClient: EligibilityPrismaClient = defaultPrisma as any
): Promise<ContentMonetizationEligibility> {
  if (!videoId || typeof videoId !== 'string') {
    return { isEligible: false, reason: 'Invalid video ID' };
  }

  try {
    const video = await prismaClient.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        title: true,
        status: true,
        visibility: true,
        isShort: true,
        duration: true,
        copyrightReviewStatus: true,
        channel: {
          select: {
            id: true,
            isMonetized: true,
            user: {
              select: {
                id: true,
                status: true,
                strikes: {
                  where: {
                    expiresAt: { gt: new Date() },
                    strikeType: { in: ['MONETIZATION_HOLD', 'SUSPENSION'] },
                  },
                  select: { id: true, strikeType: true },
                },
              },
            },
          },
        },
      },
    });

    if (!video) {
      return { isEligible: false, reason: 'Video not found' };
    }

    // 1. Content lifecycle and visibility status
    if (video.status !== 'PUBLISHED' && video.status !== 'READY') {
      return {
        isEligible: false,
        reason: `Video status "${video.status}" is not eligible for advertising`,
      };
    }

    if (video.visibility !== 'PUBLIC' && video.visibility !== 'UNLISTED') {
      return {
        isEligible: false,
        reason: 'Private videos are not eligible for advertising',
      };
    }

    if (video.copyrightReviewStatus === 'BLOCKED') {
      return {
        isEligible: false,
        reason: 'Video is blocked due to copyright infringement',
      };
    }

    // 2. Creator channel monetization standing
    if (!video.channel) {
      return { isEligible: false, reason: 'Video channel not found' };
    }

    if (!video.channel.isMonetized) {
      return {
        isEligible: false,
        reason: 'Channel is not approved for monetization in WTPP',
        channel: { id: video.channel.id, isMonetized: false },
      };
    }

    // 3. Creator user account standing
    const user = video.channel.user;
    if (user) {
      if (user.status === 'RESTRICTED' || user.status === 'SUSPENDED') {
        return {
          isEligible: false,
          reason: 'Creator user account is restricted or suspended',
        };
      }

      if (user.strikes && user.strikes.length > 0) {
        return {
          isEligible: false,
          reason: 'Creator has active monetization strikes or holds',
        };
      }
    }

    return {
      isEligible: true,
      video: {
        id: video.id,
        channelId: video.channel.id,
        title: video.title,
        isShort: Boolean(video.isShort),
        durationSeconds: video.duration ?? undefined,
      },
      channel: {
        id: video.channel.id,
        isMonetized: video.channel.isMonetized,
      },
    };
  } catch (error) {
    console.error('[Eligibility] Failed to evaluate video monetization eligibility:', error);
    return { isEligible: false, reason: 'Failed to verify content eligibility' };
  }
}
