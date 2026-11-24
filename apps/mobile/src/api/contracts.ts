import type {
  ViewerComment,
  ViewerSearchChannel,
  ViewerSession,
  ViewerVideo,
} from '@watchtube/types';

export interface FeedPage {
  videos: ViewerVideo[];
  hasMore: boolean;
}

export interface SearchPage {
  videos: ViewerVideo[];
  channels: ViewerSearchChannel[];
  hasMoreVideos: boolean;
  hasMoreChannels: boolean;
}

export interface CommentsPage {
  comments: ViewerComment[];
  nextCursor?: string;
}

export type ViewerReaction = 'liked' | 'disliked' | null;

export interface MobileUserChannel {
  id: string;
  name: string;
  handle: string;
  description?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
}

export interface MobileUserSession extends ViewerSession {
  channels?: MobileUserChannel[];
  positionNumber?: number | null;
  assignment?: string | null;
  permissions?: string[];
}

export interface ChannelProfile {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  subscriberCount: number;
  isVerified: boolean;
  videos: ViewerVideo[];
}

export const VIDEO_CATEGORIES = [
  'FILM_ANIMATION',
  'AUTOS_VEHICLES',
  'MUSIC',
  'PETS_ANIMALS',
  'SPORTS',
  'TRAVEL_EVENTS',
  'GAMING',
  'PEOPLE_BLOGS',
  'COMEDY',
  'ENTERTAINMENT',
  'NEWS_POLITICS',
  'HOWTO_STYLE',
  'EDUCATION',
  'SCIENCE_TECH',
  'NONPROFITS_ACTIVISM',
  'OTHER',
] as const;

export type VideoCategory = typeof VIDEO_CATEGORIES[number];
export type VideoVisibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
export type VideoStatus =
  | 'DRAFT'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'PUBLISHED'
  | 'FAILED'
  | 'BLOCKED'
  | 'READY'
  | 'REJECTED';

export interface CreatorVideoSummary {
  id: string;
  channelId: string;
  isShort: boolean;
  title: string;
  status: VideoStatus;
  visibility: VideoVisibility;
  thumbnailUrl: string | null;
  description: string | null;
  tags: string[];
  category: string;
  language: string;
  madeForKids: boolean;
  copyrightDeclared: boolean;
  copyrightReviewStatus: 'NOT_SCANNED' | 'BLOCKED';
  viewsCount: number;
  createdAt: string;
}

export interface CreatorVideoDetail {
  videoId: string;
  isShort: boolean;
  channelId: string;
  title: string;
  description: string | null;
  tags: string[];
  category: VideoCategory;
  language: string;
  madeForKids: boolean;
  visibility: VideoVisibility;
  copyrightDeclared: boolean;
  copyrightReviewStatus: 'NOT_SCANNED' | 'BLOCKED';
  status: VideoStatus;
  thumbnailUrl: string | null;
}

export interface UploadDraftResponse {
  videoId: string;
  status: string;
}

export interface UploadIntentResponse {
  videoId: string;
  uploadUrl: string;
  expiresIn: number;
  status: string;
}

export interface UploadUrlRefreshResponse {
  uploadUrl: string;
  expiresIn: number;
}

export interface VerifyUploadResponse {
  videoId: string;
  status: string;
}

export interface UploadStatusResponse {
  videoId: string;
  status: VideoStatus;
  thumbnailUrl: string | null;
  copyrightReviewStatus: 'NOT_SCANNED' | 'BLOCKED';
}

export interface PublishVideoResponse {
  videoId: string;
  status: VideoStatus;
  copyrightReviewStatus: 'NOT_SCANNED' | 'BLOCKED';
}

export interface PlayableVideoVariant {
  playlistUrl: string;
  resolution: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVideo(value: unknown): ViewerVideo {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.viewsCount !== 'number'
    || typeof value.createdAt !== 'string'
    || !isRecord(value.channel)
  ) {
    throw new Error('The API returned an invalid video response.');
  }
  const channel = value.channel;
  if (
    typeof channel.name !== 'string'
    || typeof channel.handle !== 'string'
    || typeof channel.isVerified !== 'boolean'
  ) {
    throw new Error('The API returned an invalid video response.');
  }
  if (
    (value.channelId !== undefined && typeof value.channelId !== 'string')
    || (value.description !== undefined && value.description !== null && typeof value.description !== 'string')
    || (value.thumbnailUrl !== undefined && value.thumbnailUrl !== null && typeof value.thumbnailUrl !== 'string')
    || (value.duration !== undefined && value.duration !== null && typeof value.duration !== 'number')
    || (value.publishedAt !== undefined && value.publishedAt !== null && typeof value.publishedAt !== 'string')
    || (value.variants !== undefined && !Array.isArray(value.variants))
    || (value.channel.avatarUrl !== undefined
      && value.channel.avatarUrl !== null
      && typeof value.channel.avatarUrl !== 'string')
    || (value.channel.bannerUrl !== undefined
      && value.channel.bannerUrl !== null
      && typeof value.channel.bannerUrl !== 'string')
    || (value.channel.description !== undefined
      && value.channel.description !== null
      && typeof value.channel.description !== 'string')
    || (value.channel.subscriberCount !== undefined
      && typeof value.channel.subscriberCount !== 'number')
  ) {
    throw new Error('The API returned invalid video metadata.');
  }
  const variants = value.variants?.map((variant) => {
    if (
      !isRecord(variant)
      || typeof variant.playlistUrl !== 'string'
      || typeof variant.resolution !== 'string'
    ) {
      throw new Error('The API returned invalid playback variants.');
    }
    return { playlistUrl: variant.playlistUrl, resolution: variant.resolution };
  });
  return {
    id: value.id,
    title: value.title,
    viewsCount: value.viewsCount,
    createdAt: value.createdAt,
    ...(typeof value.isShort === 'boolean' ? { isShort: value.isShort } : {}),
    ...(typeof value.channelId === 'string' ? { channelId: value.channelId } : {}),
    ...(typeof value.description === 'string' || value.description === null
      ? { description: value.description }
      : {}),
    ...(typeof value.thumbnailUrl === 'string' || value.thumbnailUrl === null
      ? { thumbnailUrl: value.thumbnailUrl }
      : {}),
    ...(typeof value.duration === 'number' || value.duration === null
      ? { duration: value.duration }
      : {}),
    ...(typeof value.publishedAt === 'string' || value.publishedAt === null
      ? { publishedAt: value.publishedAt }
      : {}),
    ...(variants ? { variants } : {}),
    channel: {
      ...(typeof channel.id === 'string' ? { id: channel.id } : {}),
      name: channel.name,
      handle: channel.handle,
      isVerified: channel.isVerified,
      ...(typeof channel.avatarUrl === 'string' || channel.avatarUrl === null
        ? { avatarUrl: channel.avatarUrl }
        : {}),
      ...(typeof channel.bannerUrl === 'string' || channel.bannerUrl === null
        ? { bannerUrl: channel.bannerUrl }
        : {}),
      ...(typeof channel.description === 'string' || channel.description === null
        ? { description: channel.description }
        : {}),
      ...(typeof channel.subscriberCount === 'number' ? { subscriberCount: channel.subscriberCount } : {}),
    },
  };
}

function isPlayableMediaUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getPlayableVariants(
  variants?: readonly { playlistUrl: string; resolution: string }[],
): PlayableVideoVariant[] {
  if (!variants?.length) return [];
  const valid = variants.filter((variant) => isPlayableMediaUrl(variant.playlistUrl));
  const preferenceOrder = new Map<string, number>([
    ['720p', 0],
    ['540p', 1],
    ['360p', 2],
    ['1080p', 3],
  ]);
  return [...valid].sort((left, right) => {
    const leftRank = preferenceOrder.get(left.resolution) ?? 99;
    const rightRank = preferenceOrder.get(right.resolution) ?? 99;
    return leftRank - rightRank;
  });
}

export function selectPreferredPlaylistUrl(
  variants?: readonly { playlistUrl: string; resolution: string }[],
): string | null {
  return getPlayableVariants(variants)[0]?.playlistUrl ?? null;
}

export function parseViewerVideo(value: unknown): ViewerVideo {
  return parseVideo(value);
}

function parseVideos(value: unknown): ViewerVideo[] {
  if (!Array.isArray(value)) throw new Error('The API returned an invalid video list.');
  return value.map(parseVideo);
}

function parsePagination(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('The API returned invalid pagination data.');
  return value;
}

export function parseFeedPage(value: unknown, limit = 12): FeedPage {
  if (Array.isArray(value)) {
    const videos = parseVideos(value);
    return { videos, hasMore: videos.length >= limit };
  }
  if (!isRecord(value)) throw new Error('The API returned an invalid video feed response.');

  const videos = parseVideos(value.videos);
  const pagination = parsePagination(value.pagination);
  const hasMore = pagination?.hasMore ?? pagination?.hasMoreVideos;
  if (hasMore !== undefined && typeof hasMore !== 'boolean') {
    throw new Error('The API returned invalid video pagination data.');
  }
  return { videos, hasMore: hasMore ?? videos.length >= limit };
}

export function parseSearchPage(value: unknown): SearchPage {
  if (!isRecord(value) || !Array.isArray(value.channels)) {
    throw new Error('The API returned an invalid search response.');
  }
  const pagination = parsePagination(value.pagination);
  if (
    !pagination
    || typeof pagination.hasMoreVideos !== 'boolean'
    || typeof pagination.hasMoreChannels !== 'boolean'
  ) {
    throw new Error('The API returned invalid search pagination data.');
  }

  const channels = value.channels.map((channel) => {
    if (
      !isRecord(channel)
      || typeof channel.id !== 'string'
      || typeof channel.name !== 'string'
      || typeof channel.handle !== 'string'
      || typeof channel.isVerified !== 'boolean'
      || typeof channel.subscriberCount !== 'number'
      || (channel.avatarUrl !== null && typeof channel.avatarUrl !== 'string')
    ) {
      throw new Error('The API returned an invalid channel result.');
    }
    return {
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      avatarUrl: channel.avatarUrl,
      isVerified: channel.isVerified,
      subscriberCount: channel.subscriberCount,
    };
  });

  return {
    videos: parseVideos(value.videos),
    channels,
    hasMoreVideos: pagination.hasMoreVideos,
    hasMoreChannels: pagination.hasMoreChannels,
  };
}

function parseComment(value: unknown): ViewerComment {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.content !== 'string'
    || typeof value.createdAt !== 'string'
  ) {
    throw new Error('The API returned an invalid comment response.');
  }
  if (
    value.parentId !== undefined
    && value.parentId !== null
    && typeof value.parentId !== 'string'
  ) {
    throw new Error('The API returned invalid comment metadata.');
  }
  if (
    (value._count !== undefined
      && (!isRecord(value._count) || typeof value._count.replies !== 'number'))
    || (value.user !== undefined
      && (!isRecord(value.user) || !Array.isArray(value.user.channels)))
  ) {
    throw new Error('The API returned invalid comment metadata.');
  }
  const comment: ViewerComment = {
    id: value.id,
    content: value.content,
    createdAt: value.createdAt,
  };
  if (typeof value.parentId === 'string' || value.parentId === null) {
    comment.parentId = value.parentId;
  }
  if (isRecord(value._count) && typeof value._count.replies === 'number') {
    comment._count = { replies: value._count.replies };
  }
  if (isRecord(value.user) && Array.isArray(value.user.channels)) {
    comment.user = {
      channels: value.user.channels.map((channel) => {
        if (
          !isRecord(channel)
          || typeof channel.name !== 'string'
          || typeof channel.handle !== 'string'
          || (channel.avatarUrl !== undefined
            && channel.avatarUrl !== null
            && typeof channel.avatarUrl !== 'string')
        ) {
          throw new Error('The API returned invalid comment author data.');
        }
        return {
          name: channel.name,
          handle: channel.handle,
          ...(typeof channel.avatarUrl === 'string' || channel.avatarUrl === null
            ? { avatarUrl: channel.avatarUrl }
            : {}),
        };
      }),
    };
  }
  return comment;
}

export function parseCommentsPage(value: unknown): CommentsPage {
  if (!isRecord(value) || !Array.isArray(value.comments)) {
    throw new Error('The API returned an invalid comments response.');
  }
  if (
    value.nextCursor !== undefined
    && value.nextCursor !== null
    && typeof value.nextCursor !== 'string'
  ) {
    throw new Error('The API returned invalid comment pagination data.');
  }
  return {
    comments: value.comments.map(parseComment),
    nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : undefined,
  };
}

export function appendUniqueComments(
  current: ViewerComment[],
  next: ViewerComment[],
): ViewerComment[] {
  const ids = new Set(current.map((comment) => comment.id));
  const appended: ViewerComment[] = [];
  for (const comment of next) {
    if (ids.has(comment.id)) continue;
    ids.add(comment.id);
    appended.push(comment);
  }
  return [...current, ...appended];
}

export function parseReaction(value: unknown): ViewerReaction {
  if (
    !isRecord(value)
    || typeof value.isLiked !== 'boolean'
    || typeof value.isDisliked !== 'boolean'
    || (value.isLiked && value.isDisliked)
  ) {
    throw new Error('The API returned an invalid reaction response.');
  }
  return value.isLiked ? 'liked' : value.isDisliked ? 'disliked' : null;
}

export function parseSubscription(value: unknown): boolean {
  if (!isRecord(value) || typeof value.isSubscribed !== 'boolean') {
    throw new Error('The API returned an invalid subscription response.');
  }
  return value.isSubscribed;
}

export function parseSession(value: unknown): MobileUserSession | null {
  if (value === null) return null;
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.email !== 'string'
    || value.email.length === 0
    || (value.role !== undefined && typeof value.role !== 'string')
    || (value.status !== undefined && typeof value.status !== 'string')
  ) {
    throw new Error('The API returned an invalid session response.');
  }

  let channels: MobileUserChannel[] | undefined;
  if (Array.isArray(value.channels)) {
    channels = value.channels.map((ch) => {
      if (
        !isRecord(ch)
        || typeof ch.id !== 'string'
        || typeof ch.name !== 'string'
        || typeof ch.handle !== 'string'
      ) {
        throw new Error('The API returned invalid channel data in session.');
      }
      return {
        id: ch.id,
        name: ch.name,
        handle: ch.handle,
        description: typeof ch.description === 'string' || ch.description === null ? ch.description : null,
        avatarUrl: typeof ch.avatarUrl === 'string' || ch.avatarUrl === null ? ch.avatarUrl : null,
        bannerUrl: typeof ch.bannerUrl === 'string' || ch.bannerUrl === null ? ch.bannerUrl : null,
      };
    });
  }

  return {
    id: value.id,
    email: value.email,
    ...(typeof value.role === 'string' ? { role: value.role } : {}),
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
    ...(channels ? { channels } : {}),
    ...(typeof value.positionNumber === 'number' || value.positionNumber === null
      ? { positionNumber: value.positionNumber as number | null }
      : {}),
    ...(typeof value.assignment === 'string' || value.assignment === null
      ? { assignment: value.assignment as string | null }
      : {}),
    ...(Array.isArray(value.permissions)
      ? { permissions: value.permissions.filter((p): p is string => typeof p === 'string') }
      : {}),
  };
}

export function parseChannelProfile(value: unknown): ChannelProfile {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.handle !== 'string'
    || typeof value.subscriberCount !== 'number'
    || typeof value.isVerified !== 'boolean'
    || !Array.isArray(value.videos)
  ) {
    throw new Error('The API returned an invalid channel profile.');
  }

  const channelId = value.id as string;
  const channelMeta = {
    name: value.name as string,
    handle: value.handle as string,
    isVerified: Boolean(value.isVerified),
    ...(typeof value.avatarUrl === 'string' || value.avatarUrl === null
      ? { avatarUrl: value.avatarUrl }
      : {}),
  };

  const videos: ViewerVideo[] = value.videos.map((v) => {
    if (
      !isRecord(v)
      || typeof v.id !== 'string'
      || typeof v.title !== 'string'
      || typeof v.viewsCount !== 'number'
      || typeof v.createdAt !== 'string'
    ) {
      throw new Error('The API returned invalid channel video data.');
    }
    return {
      id: v.id,
      title: v.title,
      viewsCount: v.viewsCount,
      createdAt: v.createdAt,
      channelId,
      ...(typeof v.description === 'string' || v.description === null
        ? { description: v.description }
        : {}),
      ...(typeof v.thumbnailUrl === 'string' || v.thumbnailUrl === null
        ? { thumbnailUrl: v.thumbnailUrl }
        : {}),
      ...(typeof v.duration === 'number' || v.duration === null
        ? { duration: v.duration }
        : {}),
      ...(typeof v.publishedAt === 'string' || v.publishedAt === null
        ? { publishedAt: v.publishedAt }
        : {}),
      channel: channelMeta,
    };
  });

  return {
    id: channelId,
    name: value.name as string,
    handle: value.handle as string,
    description: typeof value.description === 'string' || value.description === null ? value.description : null,
    avatarUrl: typeof value.avatarUrl === 'string' || value.avatarUrl === null ? value.avatarUrl : null,
    bannerUrl: typeof value.bannerUrl === 'string' || value.bannerUrl === null ? value.bannerUrl : null,
    subscriberCount: value.subscriberCount as number,
    isVerified: Boolean(value.isVerified),
    videos,
  };
}

export function parseCreatorVideos(value: unknown): CreatorVideoSummary[] {
  if (!Array.isArray(value)) throw new Error('The API returned an invalid creator video list.');
  return value.map((v) => {
    if (
      !isRecord(v)
      || typeof v.id !== 'string'
      || typeof v.title !== 'string'
      || typeof v.status !== 'string'
      || typeof v.visibility !== 'string'
      || typeof v.viewsCount !== 'number'
      || typeof v.createdAt !== 'string'
    ) {
      throw new Error('The API returned an invalid creator video summary.');
    }
    return {
      id: v.id,
      channelId: typeof v.channelId === 'string' ? v.channelId : '',
      isShort: Boolean(v.isShort),
      title: v.title,
      status: v.status as CreatorVideoSummary['status'],
      visibility: v.visibility as CreatorVideoSummary['visibility'],
      thumbnailUrl: typeof v.thumbnailUrl === 'string' || v.thumbnailUrl === null ? v.thumbnailUrl : null,
      description: typeof v.description === 'string' || v.description === null ? v.description : null,
      tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [],
      category: typeof v.category === 'string' ? v.category : 'OTHER',
      language: typeof v.language === 'string' ? v.language : 'en',
      madeForKids: Boolean(v.madeForKids),
      copyrightDeclared: Boolean(v.copyrightDeclared),
      copyrightReviewStatus: (v.copyrightReviewStatus === 'BLOCKED' ? 'BLOCKED' : 'NOT_SCANNED') as 'NOT_SCANNED' | 'BLOCKED',
      viewsCount: v.viewsCount,
      createdAt: v.createdAt,
    };
  });
}

export function parseUploadDraft(value: unknown): UploadDraftResponse {
  if (!isRecord(value) || typeof value.videoId !== 'string' || typeof value.status !== 'string') {
    throw new Error('The API returned an invalid draft response.');
  }
  return { videoId: value.videoId, status: value.status };
}

export function parseUploadIntent(value: unknown): UploadIntentResponse {
  if (
    !isRecord(value)
    || typeof value.videoId !== 'string'
    || typeof value.uploadUrl !== 'string'
    || !isPlayableMediaUrl(value.uploadUrl)
    || typeof value.expiresIn !== 'number'
    || typeof value.status !== 'string'
  ) {
    throw new Error('The API returned an invalid upload intent response.');
  }
  return {
    videoId: value.videoId,
    uploadUrl: value.uploadUrl,
    expiresIn: value.expiresIn,
    status: value.status,
  };
}

export function parseUploadUrlRefresh(value: unknown): UploadUrlRefreshResponse {
  if (
    !isRecord(value)
    || typeof value.uploadUrl !== 'string'
    || !isPlayableMediaUrl(value.uploadUrl)
    || typeof value.expiresIn !== 'number'
  ) {
    throw new Error('The API returned an invalid upload URL refresh response.');
  }
  return {
    uploadUrl: value.uploadUrl,
    expiresIn: value.expiresIn,
  };
}

export function parseVerifyUploadResponse(value: unknown): VerifyUploadResponse {
  if (!isRecord(value) || typeof value.videoId !== 'string' || typeof value.status !== 'string') {
    throw new Error('The API returned an invalid upload verification response.');
  }
  return { videoId: value.videoId, status: value.status };
}

export function parseUploadStatus(value: unknown): UploadStatusResponse {
  if (
    !isRecord(value)
    || typeof value.videoId !== 'string'
    || typeof value.status !== 'string'
    || (value.thumbnailUrl !== undefined && value.thumbnailUrl !== null && typeof value.thumbnailUrl !== 'string')
  ) {
    throw new Error('The API returned an invalid upload status response.');
  }
  return {
    videoId: value.videoId,
    status: value.status as VideoStatus,
    thumbnailUrl: typeof value.thumbnailUrl === 'string' ? value.thumbnailUrl : null,
    copyrightReviewStatus: value.copyrightReviewStatus === 'BLOCKED' ? 'BLOCKED' : 'NOT_SCANNED',
  };
}

export function parsePublishResponse(value: unknown): PublishVideoResponse {
  if (
    !isRecord(value)
    || typeof value.videoId !== 'string'
    || typeof value.status !== 'string'
  ) {
    throw new Error('The API returned an invalid publish response.');
  }
  return {
    videoId: value.videoId,
    status: value.status as VideoStatus,
    copyrightReviewStatus: value.copyrightReviewStatus === 'BLOCKED' ? 'BLOCKED' : 'NOT_SCANNED',
  };
}

export function parseCreatorVideoDetail(value: unknown): CreatorVideoDetail {
  if (
    !isRecord(value)
    || typeof value.videoId !== 'string'
    || typeof value.channelId !== 'string'
    || typeof value.title !== 'string'
    || typeof value.status !== 'string'
    || typeof value.visibility !== 'string'
  ) {
    throw new Error('The API returned an invalid creator video detail response.');
  }
  const category = typeof value.category === 'string'
    && (VIDEO_CATEGORIES as readonly string[]).includes(value.category)
    ? value.category as VideoCategory
    : 'OTHER';
  const visibility: VideoVisibility = value.visibility === 'PUBLIC' || value.visibility === 'UNLISTED'
    ? value.visibility
    : 'PRIVATE';
  return {
    videoId: value.videoId,
    isShort: Boolean(value.isShort),
    channelId: value.channelId,
    title: value.title,
    description: typeof value.description === 'string' ? value.description : null,
    tags: Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === 'string') : [],
    category,
    language: typeof value.language === 'string' ? value.language : 'en',
    madeForKids: Boolean(value.madeForKids),
    visibility,
    copyrightDeclared: Boolean(value.copyrightDeclared),
    copyrightReviewStatus: value.copyrightReviewStatus === 'BLOCKED' ? 'BLOCKED' : 'NOT_SCANNED',
    status: value.status as VideoStatus,
    thumbnailUrl: typeof value.thumbnailUrl === 'string' ? value.thumbnailUrl : null,
  };
}

export function assertAuthSuccess(value: unknown, action: 'sign-in' | 'sign-out' | 'register'): void {
  if (!isRecord(value) || (action === 'register' ? typeof value.id !== 'string' : value.success !== true)) {
    throw new Error(`The API did not confirm ${action}.`);
  }
}
