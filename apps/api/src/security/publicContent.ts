import type { Prisma } from '@watchtube/database';

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
