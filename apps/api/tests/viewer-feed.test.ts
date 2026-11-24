import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, test } from 'node:test';
import type { Prisma } from '@watchtube/database';
import {
  createAuthenticate,
  createOptionalAuthenticate,
  type AuthenticatedUser,
} from '../src/middleware/auth';
import {
  buildTrendingQuery,
  createPublicVideosHandler,
  createFeedRouter,
  rankTrendingVideos,
  type TrendingPageQuery,
} from '../src/routes/feed.route';
import { createSubscriptionFeedRouter, interactionRouter } from '../src/routes/interaction.route';
import { JWT_SECRET } from '../src/config/jwt';
import {
  buildRecommendationCandidateQuery,
  buildViewerActivityQueries,
  createForYouService,
  rankForYouVideos,
  RECOMMENDATION_CONFIG,
  type RecommendationCandidate,
  type ViewerActivity,
} from '../src/services/recommendation.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const video = { id: 'public-video-from-test-repository' };
const channel = { name: 'Public channel', handle: '@public', avatarUrl: null, isVerified: false };
function trendingVideo(
  id: string,
  activity: { viewEvents: number; likes: number; comments: number },
  publishedAt = new Date('2026-11-18T12:00:00.000Z'),
) {
  return {
    id,
    title: id,
    description: null,
    thumbnailUrl: null,
    duration: null,
    viewsCount: 0,
    createdAt: publishedAt,
    publishedAt,
    channel,
    _count: activity,
  };
}

const recommendationNow = new Date('2026-11-21T12:00:00.000Z');

function recommendationVideo(
  id: string,
  options: Partial<RecommendationCandidate> = {},
): RecommendationCandidate {
  const createdAt = options.createdAt ?? recommendationNow;
  return {
    id,
    isShort: false,
    title: id,
    description: null,
    thumbnailUrl: null,
    duration: 120,
    viewsCount: 0,
    createdAt,
    publishedAt: options.publishedAt ?? createdAt,
    channelId: options.channelId ?? `channel-${id}`,
    category: options.category ?? 'MUSIC',
    tags: options.tags ?? [],
    channel,
    ...options,
  };
}

function activityFor(
  category = 'MUSIC',
  tags: string[] = ['acoustic'],
  videoId = 'watched-video',
): ViewerActivity {
  return {
    watchHistory: [{
      videoId,
      category,
      tags,
      channelId: 'history-channel',
      completed: true,
      lastPositionSeconds: 120,
      updatedAt: recommendationNow,
    }],
  };
}

function publicTrendingVideo<T extends { _count: unknown }>(candidate: T) {
  const { _count, ...videoResult } = candidate;
  return videoResult;
}

const token = jwt.sign({ id: USER_ID, role: 'VIEWER' }, JWT_SECRET, { expiresIn: '1h' });
let activeServers: Server[] = [];

async function startServer(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function authenticate(status: AuthenticatedUser['status'] = 'GOOD_STANDING') {
  return createAuthenticate(async (id) => ({ id, role: 'VIEWER', status }));
}

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  activeServers = [];
});

test('home feed returns real repository results with public and ready filters', async () => {
  let query: Prisma.VideoFindManyArgs | undefined;
  const app = express();
  app.get('/api/v1/videos', createPublicVideosHandler(async (args) => {
    query = args;
    return [video];
  }));
  const response = await fetch(`${await startServer(app)}/api/v1/videos`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [video]);
  assert.deepEqual(query?.where, {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
    isShort: false,
    copyrightReviewStatus: { not: 'BLOCKED' },
    channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
  });
  assert.deepEqual(query?.select, {
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
  });
});

test('home feed reports a missing database as service unavailable without exposing details', async () => {
  const app = express();
  app.get('/api/v1/videos', createPublicVideosHandler(async () => {
    const error = new Error('database connection detail must not be returned');
    error.name = 'PrismaClientInitializationError';
    throw error;
  }));
  const response = await fetch(`${await startServer(app)}/api/v1/videos`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Discover videos are temporarily unavailable because the database is unavailable.',
  });
});

test('trending ranking uses recent valid views, positive likes, comments, and deterministic ties', () => {
  const mostRecent = trendingVideo(
    'more-recent',
    { viewEvents: 1, likes: 1, comments: 0 },
    new Date('2026-11-19T12:00:00.000Z'),
  );
  const higherScore = trendingVideo('higher-score', { viewEvents: 0, likes: 2, comments: 0 });
  const tiedByDate = trendingVideo('a-tie', { viewEvents: 4, likes: 0, comments: 0 });
  const tiedById = trendingVideo('b-tie', { viewEvents: 4, likes: 0, comments: 0 });
  const input = [mostRecent, tiedById, higherScore, tiedByDate];

  assert.deepEqual(
    rankTrendingVideos(input).map(({ id }) => id),
    ['higher-score', 'more-recent', 'a-tie', 'b-tie'],
  );
  assert.deepEqual(input.map(({ id }) => id), ['more-recent', 'b-tie', 'higher-score', 'a-tie']);
});

test('trending uses a seven-day activity window, filters ineligible videos, and paginates ranked results', async () => {
  const queries: TrendingPageQuery[] = [];
  let shouldFail = false;
  const rankedResults = rankTrendingVideos([
    trendingVideo('first-place', { viewEvents: 0, likes: 2, comments: 0 }),
    trendingVideo('second-place', { viewEvents: 1, likes: 1, comments: 0 }),
  ]).map(publicTrendingVideo);
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async () => [],
    async () => [],
    async (args) => {
      queries.push(args);
      if (shouldFail) throw Object.assign(new Error('database offline'), { errorCode: 'P1001' });
      return rankedResults.slice(args.skip, args.skip + args.take);
    },
  ));
  const baseUrl = await startServer(app);

  const firstPage = await fetch(`${baseUrl}/api/v1/feed/trending?limit=1`);
  assert.equal(firstPage.status, 200);
  assert.deepEqual(await firstPage.json(), {
    videos: [{
      id: 'first-place',
      title: 'first-place',
      description: null,
      thumbnailUrl: null,
      duration: null,
      viewsCount: 0,
      createdAt: '2026-11-18T12:00:00.000Z',
      publishedAt: '2026-11-18T12:00:00.000Z',
      channel,
    }],
    pagination: { page: 1, limit: 1, hasMore: true },
  });

  const success = await fetch(`${baseUrl}/api/v1/feed/trending?page=2&limit=1`);
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), {
    videos: [{
      id: 'second-place',
      title: 'second-place',
      description: null,
      thumbnailUrl: null,
      duration: null,
      viewsCount: 0,
      createdAt: '2026-11-18T12:00:00.000Z',
      publishedAt: '2026-11-18T12:00:00.000Z',
      channel,
    }],
    pagination: { page: 2, limit: 1, hasMore: false },
  });
  assert.equal(queries.length, 2);
  assert.equal(queries[0].take, 2);
  assert.equal(queries[0].skip, 0);
  assert.equal(queries[1].take, 2);
  assert.equal(queries[1].skip, 1);
  assert.ok(Date.now() - queries[0].windowStart.getTime() >= 7 * 24 * 60 * 60 * 1000 - 1000);
  assert.ok(Date.now() - queries[0].windowStart.getTime() <= 7 * 24 * 60 * 60 * 1000 + 1000);

  shouldFail = true;
  const failure = await fetch(`${baseUrl}/api/v1/feed/trending`);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), {
    error: 'Trending videos are temporarily unavailable because the database is unavailable.',
  });
});

test('trending SQL applies public eligibility filters and bounds ranked results in the database', () => {
  const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const query = buildTrendingQuery({ windowStart, take: 13, skip: 24 });

  assert.match(query.sql, /video\."status" IN \('READY', 'PUBLISHED'\)/);
  assert.match(query.sql, /video\."visibility" = 'PUBLIC'/);
  assert.match(query.sql, /video\."copyrightReviewStatus" <> 'BLOCKED'/);
  assert.match(query.sql, /creator\."status" NOT IN \('RESTRICTED', 'SUSPENDED'\)/);
  assert.match(query.sql, /view_event\."isValidView" = TRUE/);
  assert.match(query.sql, /video_like\."isDislike" = FALSE/);
  assert.match(query.sql, /ORDER BY \(/);
  assert.match(query.sql, /LIMIT .* OFFSET /s);
  assert.equal(query.values.filter((value) => value === windowStart).length, 3);
  assert.ok(query.values.includes(1));
  assert.ok(query.values.includes(3));
  assert.ok(query.values.includes(4));
  assert.ok(query.values.includes(13));
  assert.ok(query.values.includes(24));
});

test('trending returns an empty page when there is no recent public activity', async () => {
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async () => [],
    async () => [],
    async () => [],
  ));
  const response = await fetch(`${await startServer(app)}/api/v1/feed/trending`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    videos: [],
    pagination: { page: 1, limit: 12, hasMore: false },
  });
});

test('trending rejects malformed pagination before querying', async () => {
  let queries = 0;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(async () => {
    queries += 1;
    return [];
  }));
  const baseUrl = await startServer(app);

  for (const url of [
    '/api/v1/feed/trending?page=0',
    '/api/v1/feed/trending?page=1001',
    '/api/v1/feed/trending?limit=51',
  ]) {
    const response = await fetch(`${baseUrl}${url}`);
    assert.equal(response.status, 400);
  }
  assert.equal(queries, 0);
});

test('search returns separately paginated public video and creator results', async () => {
  let videoQuery: Prisma.VideoFindManyArgs | undefined;
  let channelQuery: Prisma.ChannelFindManyArgs | undefined;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async (args) => {
      videoQuery = args;
      return [video, { id: 'second-video' }, { id: 'third-video' }, { id: 'lookahead-video' }];
    },
    async (args) => {
      channelQuery = args;
      return [{ id: 'creator-1' }, { id: 'creator-2' }, { id: 'creator-3' }, { id: 'lookahead-creator' }];
    },
  ));
  const response = await fetch(`${await startServer(app)}/api/v1/feed/search?q=%20music%20&page=2&limit=3`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    videos: [video, { id: 'second-video' }, { id: 'third-video' }],
    channels: [{ id: 'creator-1' }, { id: 'creator-2' }, { id: 'creator-3' }],
    pagination: { page: 2, limit: 3, hasMoreVideos: true, hasMoreChannels: true },
  });
  assert.deepEqual(videoQuery?.where, {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
    isShort: false,
    copyrightReviewStatus: { not: 'BLOCKED' },
    channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
    OR: [
      { title: { contains: 'music', mode: 'insensitive' } },
      { description: { contains: 'music', mode: 'insensitive' } },
      { channel: { name: { contains: 'music', mode: 'insensitive' } } },
      { channel: { handle: { contains: 'music', mode: 'insensitive' } } },
    ],
  });
  assert.equal(videoQuery?.skip, 3);
  assert.equal(videoQuery?.take, 4);
  assert.deepEqual(videoQuery?.orderBy, [
    { viewsCount: 'desc' },
    { createdAt: 'desc' },
    { id: 'asc' },
  ]);
  assert.deepEqual(videoQuery?.select, {
    id: true,
    isShort: true,
    title: true,
    description: true,
    thumbnailUrl: true,
    duration: true,
    viewsCount: true,
    createdAt: true,
    publishedAt: true,
    channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
  });
  assert.deepEqual(channelQuery?.where, {
    user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } },
    OR: [
      { name: { contains: 'music', mode: 'insensitive' } },
      { handle: { contains: 'music', mode: 'insensitive' } },
    ],
  });
  assert.equal(channelQuery?.skip, 3);
  assert.equal(channelQuery?.take, 4);
  assert.deepEqual(channelQuery?.orderBy, [
    { subscriberCount: 'desc' },
    { name: 'asc' },
    { id: 'asc' },
  ]);
  assert.deepEqual(channelQuery?.select, {
    id: true,
    name: true,
    handle: true,
    avatarUrl: true,
    isVerified: true,
    subscriberCount: true,
  });
});

test('search pages do not repeat or skip ordered repository results', async () => {
  const records = Array.from({ length: 5 }, (_, index) => ({ id: `video-${index + 1}` }));
  const requests: Prisma.VideoFindManyArgs[] = [];
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async (args) => {
      requests.push(args);
      const skip = args.skip ?? 0;
      return records.slice(skip, skip + (args.take ?? 0));
    },
    async () => [],
  ));
  const baseUrl = await startServer(app);

  const firstPage = await fetch(`${baseUrl}/api/v1/feed/search?q=music&page=1&limit=2`);
  const secondPage = await fetch(`${baseUrl}/api/v1/feed/search?q=music&page=2&limit=2`);
  assert.equal(firstPage.status, 200);
  assert.equal(secondPage.status, 200);
  const firstResults = (await firstPage.json()).videos as Array<{ id: string }>;
  const secondResults = (await secondPage.json()).videos as Array<{ id: string }>;

  assert.deepEqual(firstResults.map(({ id }) => id), ['video-1', 'video-2']);
  assert.deepEqual(secondResults.map(({ id }) => id), ['video-3', 'video-4']);
  assert.deepEqual(firstResults.filter(({ id }) => secondResults.some((next) => next.id === id)), []);
  assert.equal(requests[0].skip, 0);
  assert.equal(requests[1].skip, 2);
  assert.equal(requests[0].take, 3);
  assert.equal(requests[1].take, 3);
});

test('search preserves special characters in a trimmed, parameterized query', async () => {
  let videoQuery: Prisma.VideoFindManyArgs | undefined;
  let channelQuery: Prisma.ChannelFindManyArgs | undefined;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async (args) => { videoQuery = args; return []; },
    async (args) => { channelQuery = args; return []; },
  ));
  const term = "  O'Reilly 100%_\\music? & #  ";
  const response = await fetch(
    `${await startServer(app)}/api/v1/feed/search?${new URLSearchParams({ q: term })}`,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    videos: [],
    channels: [],
    pagination: { page: 1, limit: 12, hasMoreVideos: false, hasMoreChannels: false },
  });
  const expectedTerm = term.trim();
  const includesExpectedTerm = (value: object): boolean => Object.values(value).some((field) => {
    if (typeof field !== 'object' || field === null) return false;
    if ('contains' in field) return field.contains === expectedTerm;
    return includesExpectedTerm(field);
  });
  assert.ok(videoQuery?.where?.OR?.every(includesExpectedTerm));
  assert.ok(channelQuery?.where?.OR?.every(includesExpectedTerm));
});

test('search returns empty public result sets and hides database failures', async () => {
  let shouldFail = false;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async () => {
      if (shouldFail) throw Object.assign(new Error('database offline'), { errorCode: 'P1001' });
      return [];
    },
    async () => [],
  ));
  const baseUrl = await startServer(app);

  const empty = await fetch(`${baseUrl}/api/v1/feed/search?q=missing`);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {
    videos: [],
    channels: [],
    pagination: { page: 1, limit: 12, hasMoreVideos: false, hasMoreChannels: false },
  });

  shouldFail = true;
  const failure = await fetch(`${baseUrl}/api/v1/feed/search?q=music`);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), {
    error: 'Search is temporarily unavailable because the database is unavailable.',
  });
});

test('Shorts feed returns only published public Shorts and rejects invalid pagination', async () => {
  let shortsQuery: Prisma.VideoFindManyArgs | undefined;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async (args) => {
      shortsQuery = args;
      return [{ id: 'short-1', isShort: true }, { id: 'short-2', isShort: true }];
    },
  ));
  const baseUrl = await startServer(app);

  const response = await fetch(`${baseUrl}/api/v1/feed/shorts?page=1&limit=1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.videos.length, 1);
  assert.equal(body.videos[0].isShort, true);
  assert.equal(body.pagination.hasMore, true);
  assert.equal((shortsQuery?.where as { isShort?: boolean })?.isShort, true);

  const invalid = await fetch(`${baseUrl}/api/v1/feed/shorts?page=0`);
  assert.equal(invalid.status, 400);
});

test('search rejects blank, oversized, and malformed pagination parameters before querying', async () => {
  let queries = 0;
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async () => { queries += 1; return []; },
    async () => { queries += 1; return []; },
  ));
  const baseUrl = await startServer(app);

  for (const url of [
    '/api/v1/feed/search',
    '/api/v1/feed/search?q=%20%20',
    `/api/v1/feed/search?q=${'x'.repeat(101)}`,
    '/api/v1/feed/search?q=music&page=0',
    '/api/v1/feed/search?q=music&limit=51',
    '/api/v1/feed/search?q=music&q=video',
  ]) {
    const response = await fetch(`${baseUrl}${url}`);
    assert.equal(response.status, 400);
  }
  assert.equal(queries, 0);
});

test('subscriptions reject unauthenticated requests and return only public videos from followed channels', async () => {
  let channelLookupCount = 0;
  let query: Prisma.VideoFindManyArgs | undefined;
  const app = express();
  app.use(createSubscriptionFeedRouter(authenticate(), {
    async findChannelIds(userId) {
      channelLookupCount += 1;
      assert.equal(userId, USER_ID);
      return [{ channelId: CHANNEL_ID }];
    },
    async findVideos(args) {
      query = args;
      return [video];
    },
  }));
  const baseUrl = await startServer(app);

  const unauthenticated = await fetch(`${baseUrl}/feed/subscriptions`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(channelLookupCount, 0);

  const authenticated = await fetch(`${baseUrl}/feed/subscriptions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), [video]);
  assert.deepEqual(query?.where, {
    channelId: { in: [CHANNEL_ID] },
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
  });
});

test('reaction status route is registered before any reaction write and requires authentication', async () => {
  const app = express();
  app.use(interactionRouter);
  const response = await fetch(`${await startServer(app)}/videos/${video.id}/like-status`);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
});

test('subscriptions report database failures and preserve account restrictions', async () => {
  const app = express();
  app.use(createSubscriptionFeedRouter(authenticate(), {
    async findChannelIds() {
      throw Object.assign(new Error('database offline'), { code: 'P1003' });
    },
    async findVideos() {
      return [];
    },
  }));
  const baseUrl = await startServer(app);

  const unavailable = await fetch(`${baseUrl}/feed/subscriptions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: 'Subscriptions are temporarily unavailable because the database is unavailable.',
  });

  const restrictedApp = express();
  restrictedApp.use(createSubscriptionFeedRouter(authenticate('RESTRICTED'), {
    async findChannelIds() {
      throw new Error('restricted accounts must not query subscriptions');
    },
    async findVideos() {
      return [];
    },
  }));
  const restrictedBaseUrl = await startServer(restrictedApp);
  const restricted = await fetch(`${restrictedBaseUrl}/feed/subscriptions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(restricted.status, 403);
});

test('For You cold-start falls back to deterministic public discovery ordering', () => {
  const videos = [
    recommendationVideo('older', { publishedAt: new Date('2026-11-01T00:00:00.000Z') }),
    recommendationVideo('newer', { publishedAt: new Date('2026-11-20T00:00:00.000Z') }),
    recommendationVideo('popular', { viewsCount: 100 }),
  ];

  assert.deepEqual(
    rankForYouVideos(videos, {}, recommendationNow).map(({ id }) => id),
    ['popular', 'newer', 'older'],
  );
  assert.deepEqual(
    rankForYouVideos(videos, undefined, recommendationNow).map(({ id }) => id),
    ['popular', 'newer', 'older'],
  );
});

test('For You personalizes with meaningful watch and engagement activity', () => {
  const videos = [
    recommendationVideo('unrelated', { category: 'SPORTS', tags: ['football'] }),
    recommendationVideo('watch-match', { category: 'MUSIC', tags: ['acoustic'] }),
    recommendationVideo('tag-match', { category: 'SPORTS', tags: ['acoustic'] }),
  ];
  const activity: ViewerActivity = {
    ...activityFor(),
    likes: [{
      videoId: 'liked-video',
      category: 'MUSIC',
      tags: ['acoustic'],
      channelId: 'liked-channel',
      isDislike: false,
      createdAt: recommendationNow,
    }],
    comments: [{
      category: 'MUSIC',
      tags: ['acoustic'],
      channelId: 'comment-channel',
      createdAt: recommendationNow,
    }],
  };

  const ranked = rankForYouVideos(videos, activity, recommendationNow);
  assert.equal(ranked[0].id, 'watch-match');
  assert.ok(ranked.findIndex(({ id }) => id === 'tag-match') < ranked.findIndex(({ id }) => id === 'unrelated'));
});

test('For You reduces recommendations matching the viewer’s recorded dislikes', () => {
  const disliked = Array.from({ length: 5 }, (_, index) => ({
    videoId: `disliked-${index}`,
    category: 'MUSIC',
    tags: ['acoustic'],
    channelId: `disliked-channel-${index}`,
    isDislike: true,
    createdAt: recommendationNow,
  }));
  const ranked = rankForYouVideos([
    recommendationVideo('disliked-topic', { category: 'MUSIC', tags: ['acoustic'] }),
    recommendationVideo('other-topic', { category: 'SPORTS', tags: ['football'] }),
  ], { likes: disliked }, recommendationNow);

  assert.deepEqual(ranked.map(({ id }) => id), ['other-topic', 'disliked-topic']);
});

test('For You gives recent activity more influence and favors recent candidates', () => {
  const recent = new Date('2026-11-20T12:00:00.000Z');
  const old = new Date('2026-06-01T12:00:00.000Z');
  const candidates = [
    recommendationVideo('new-relevant', { category: 'MUSIC', publishedAt: recent }),
    recommendationVideo('old-relevant', { category: 'MUSIC', publishedAt: old }),
    recommendationVideo('new-other', { category: 'SPORTS', publishedAt: recent }),
  ];
  const oldActivity = activityFor('MUSIC', ['acoustic']);
  oldActivity.watchHistory![0].updatedAt = old;
  const recentActivity = activityFor('SPORTS', ['football']);

  assert.equal(rankForYouVideos(candidates, oldActivity, recommendationNow)[0].id, 'new-relevant');
  assert.equal(rankForYouVideos(candidates, recentActivity, recommendationNow)[0].id, 'new-other');
});

test('For You suppresses recent repeats without permanently excluding watched videos', () => {
  const recentHistory = {
    videoId: 'watched',
    category: 'MUSIC',
    tags: ['acoustic'],
    channelId: 'watched-channel',
    completed: true,
    lastPositionSeconds: 120,
    updatedAt: recommendationNow,
  };
  const candidates = [
    recommendationVideo('watched', { category: 'MUSIC', tags: ['acoustic'] }),
    recommendationVideo('unwatched', { category: 'MUSIC', tags: ['acoustic'] }),
  ];
  const ranked = rankForYouVideos(candidates, { watchHistory: [recentHistory] }, recommendationNow);

  assert.deepEqual(ranked.map(({ id }) => id), ['unwatched', 'watched']);
  assert.equal(ranked.some(({ id }) => id === 'watched'), true);

  const agedHistory = { ...recentHistory, updatedAt: new Date('2026-10-01T00:00:00.000Z') };
  const aged = rankForYouVideos(candidates, { watchHistory: [agedHistory] }, recommendationNow);
  assert.equal(aged.some(({ id }) => id === 'watched'), true);
  assert.ok(RECOMMENDATION_CONFIG.watchedSuppression.olderMultiplier > 0);
});

test('For You removes duplicate candidate ids and keeps equal-score ordering stable', () => {
  const input = [
    recommendationVideo('b'),
    recommendationVideo('a'),
    recommendationVideo('a', { title: 'duplicate record' }),
  ];

  const ranked = rankForYouVideos(input, {}, recommendationNow);
  assert.deepEqual(ranked.map(({ id }) => id), ['a', 'b']);
  assert.equal(ranked.find(({ id }) => id === 'a')?.title, 'a');
});

test('For You balances creators while preserving the ordered candidate set', () => {
  const candidates = [
    ...Array.from({ length: 8 }, (_, index) => recommendationVideo(`first-${index}`, {
      channelId: 'creator-a',
      category: 'MUSIC',
      viewsCount: 100 - index,
    })),
    ...Array.from({ length: 8 }, (_, index) => recommendationVideo(`second-${index}`, {
      channelId: 'creator-b',
      category: 'MUSIC',
      viewsCount: 80 - index,
    })),
    ...Array.from({ length: 8 }, (_, index) => recommendationVideo(`third-${index}`, {
      channelId: 'creator-c',
      category: 'MUSIC',
      viewsCount: 60 - index,
    })),
  ];
  const ranked = rankForYouVideos(candidates, {}, recommendationNow);
  const creatorCap = Math.max(
    RECOMMENDATION_CONFIG.creatorDiversity.maxPerWindow,
    Math.ceil(
      RECOMMENDATION_CONFIG.creatorDiversity.windowSize
        / new Set(candidates.map(({ channelId }) => channelId)).size,
    ),
  );

  assert.equal(new Set(ranked.map(({ id }) => id)).size, candidates.length);
  for (let start = 0; start + RECOMMENDATION_CONFIG.creatorDiversity.windowSize <= ranked.length; start += 1) {
    const window = ranked.slice(start, start + RECOMMENDATION_CONFIG.creatorDiversity.windowSize);
    const counts = new Map<string, number>();
    for (const candidate of window) {
      counts.set(candidate.channelId, (counts.get(candidate.channelId) ?? 0) + 1);
    }
    assert.ok([...counts.values()].every((count) => count <= creatorCap));
  }
});

test('For You query uses eligible public projections and scopes every private signal to the viewer', () => {
  const candidateQuery = buildRecommendationCandidateQuery();
  assert.deepEqual(candidateQuery.where, {
    status: { in: ['READY', 'PUBLISHED'] },
    visibility: 'PUBLIC',
    isShort: false,
    copyrightReviewStatus: { not: 'BLOCKED' },
    channel: { user: { status: { notIn: ['RESTRICTED', 'SUSPENDED'] } } },
  });
  assert.deepEqual(candidateQuery.select, {
    id: true,
    isShort: true,
    title: true,
    description: true,
    thumbnailUrl: true,
    duration: true,
    viewsCount: true,
    createdAt: true,
    publishedAt: true,
    channel: { select: { name: true, handle: true, avatarUrl: true, isVerified: true } },
    channelId: true,
    category: true,
    tags: true,
  });

  const queries = buildViewerActivityQueries(USER_ID);
  for (const query of [queries.watchHistory, queries.likes, queries.comments, queries.validViews]) {
    assert.deepEqual(query.where.userId, USER_ID);
    assert.deepEqual(query.where.video, { is: candidateQuery.where });
  }
  assert.equal(queries.validViews.where.isValidView, true);
  assert.equal(queries.subscriptions.where.subscriberId, USER_ID);
});

test('For You service supports pagination, signed-out discovery, empty pools, and incomplete activity', async () => {
  const candidates = [
    recommendationVideo('page-a', { publishedAt: new Date('2026-11-21T11:00:00.000Z') }),
    recommendationVideo('page-b', { publishedAt: new Date('2026-11-21T10:00:00.000Z') }),
    recommendationVideo('page-c', { publishedAt: new Date('2026-11-21T09:00:00.000Z') }),
  ];
  let activityRequests = 0;
  const service = createForYouService({
    async findCandidates() {
      return candidates;
    },
    async findViewerActivity(userId) {
      activityRequests += 1;
      assert.equal(userId, USER_ID);
      return { watchHistory: undefined, likes: [], comments: [] };
    },
  }, () => recommendationNow);

  const first = await service({ page: 1, limit: 2 });
  const second = await service({ page: 2, limit: 2 });
  assert.deepEqual(first.videos.map(({ id }) => id), ['page-a', 'page-b']);
  assert.deepEqual(second.videos.map(({ id }) => id), ['page-c']);
  assert.equal(new Set([...first.videos, ...second.videos].map(({ id }) => id)).size, 3);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(second.pagination.hasMore, false);
  assert.equal(first.strategy, 'discovery');
  assert.equal(activityRequests, 0);
  assert.equal('category' in first.videos[0], false);
  assert.equal('tags' in first.videos[0], false);
  assert.equal('channelId' in first.videos[0], false);

  const personalized = await service({ userId: USER_ID, page: 1, limit: 2 });
  assert.equal(personalized.strategy, 'discovery');
  assert.equal(activityRequests, 1);

  const emptyService = createForYouService({
    async findCandidates() {
      return [];
    },
    async findViewerActivity() {
      return {};
    },
  }, () => recommendationNow);
  const empty = await emptyService({ page: 1, limit: 12 });
  assert.deepEqual(empty.videos, []);
  assert.equal(empty.pagination.hasMore, false);
});

test('For You route permits signed-out discovery, personalizes a valid viewer, and rejects invalid credentials', async () => {
  let receivedUserId: string | undefined;
  const service = createForYouService({
    async findCandidates() {
      return [recommendationVideo('public-candidate')];
    },
    async findViewerActivity(userId) {
      receivedUserId = userId;
      return activityFor();
    },
  }, () => recommendationNow);
  const app = express();
  app.use('/api/v1/feed', createFeedRouter(
    async () => [],
    async () => [],
    async () => [],
    service,
    createOptionalAuthenticate(async (id) => ({
      id,
      role: 'VIEWER',
      status: 'GOOD_STANDING',
    })),
  ));
  const baseUrl = await startServer(app);

  const signedOut = await fetch(`${baseUrl}/api/v1/feed/for-you`);
  assert.equal(signedOut.status, 200);
  assert.equal((await signedOut.json()).strategy, 'discovery');
  assert.equal(receivedUserId, undefined);

  const signedIn = await fetch(`${baseUrl}/api/v1/feed/for-you`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(signedIn.status, 200);
  assert.equal((await signedIn.json()).strategy, 'personalized');
  assert.equal(receivedUserId, USER_ID);

  const invalidToken = await fetch(`${baseUrl}/api/v1/feed/for-you`, {
    headers: { authorization: 'Bearer invalid-token' },
  });
  assert.equal(invalidToken.status, 401);
});
