import type { Prisma } from '@watchtube/database';

export const publicDiscoveryVideoWhere = {
  status: { in: ['READY', 'PUBLISHED'] },
  visibility: 'PUBLIC',
  isShort: false,
  copyrightReviewStatus: { not: 'BLOCKED' },
  channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
} satisfies Prisma.VideoWhereInput;

export const publicVideoSelect = {
  id: true,
  isShort: true,
  title: true,
  description: true,
  thumbnailUrl: true,
  duration: true,
  viewsCount: true,
  createdAt: true,
  publishedAt: true,
  channel: {
    select: { name: true, handle: true, avatarUrl: true, isVerified: true },
  },
} satisfies Prisma.VideoSelect;

export function publicVideoAccessWhere(): Prisma.VideoWhereInput {
  return {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: { in: ['PUBLIC', 'UNLISTED'] },
  };
}

export function publicVideoWhere(videoId: string): Prisma.VideoWhereInput {
  return {
    id: videoId,
    ...publicVideoAccessWhere(),
  };
}

export function publicTopLevelCommentsWhere(videoId: string): Prisma.CommentWhereInput {
  return {
    videoId,
    parentId: null,
    video: { is: publicVideoAccessWhere() },
  };
}

export function publicRepliesWhere(parentId: string): Prisma.CommentWhereInput {
  const videoAccess = publicVideoAccessWhere();
  return {
    parentId,
    video: { is: videoAccess },
    parent: { is: { video: { is: videoAccess } } },
  };
}
