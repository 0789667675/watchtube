import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { Request, RequestHandler } from 'express';
import { afterEach, beforeEach, test } from 'node:test';
import {
  createCreatorCommentsRouter,
  CreatorCommentListInput,
  CreatorCommentRecord,
  CreatorCommentRepository,
} from '../src/routes/creator-comments.route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const COMMENT_ONE_ID = '55555555-5555-4555-8555-555555555555';
const COMMENT_TWO_ID = '66666666-6666-4666-8666-666666666666';
const VIDEO_ID = '77777777-7777-4777-8777-777777777777';
const FOREIGN_COMMENT_ID = '99999999-9999-4999-8999-999999999999';

interface TestHarness {
  baseUrl: string;
  server: Server;
  comments: CreatorCommentRecord[];
  calls: {
    ownership: Array<{ channelId: string; userId: string }>;
    lists: CreatorCommentListInput[];
    deletions: Array<{ channelId: string; commentId: string; userId: string }>;
    ownsChannel: boolean;
  };
}

type JsonCreatorComment = Omit<CreatorCommentRecord, 'createdAt'> & { createdAt: string };

let activeServers: Server[] = [];

function createComment(id: string, content: string): CreatorCommentRecord {
  return {
    id,
    content,
    parentId: null,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    user: {
      id: OTHER_USER_ID,
      channels: [{ name: 'Author channel', handle: '@author', avatarUrl: null }],
    },
    video: { id: VIDEO_ID, title: 'Video title' },
  };
}

async function createHarness(): Promise<TestHarness> {
  const comments = [
    createComment(COMMENT_ONE_ID, 'A useful moderation example'),
    createComment(COMMENT_TWO_ID, 'Another moderation example'),
    createComment('88888888-8888-4888-8888-888888888888', 'Unrelated comment'),
  ];
  const calls: TestHarness['calls'] = {
    ownership: [],
    lists: [],
    deletions: [],
    ownsChannel: true,
  };
  const authenticate: RequestHandler = (req, res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    (req as Request & { user?: { id: string; role: string } }).user = { id: userId, role: 'USER' };
    next();
  };
  const repository: CreatorCommentRepository = {
    ownsChannel: async (channelId, userId) => {
      calls.ownership.push({ channelId, userId });
      return calls.ownsChannel && channelId === CHANNEL_ID && userId === USER_ID;
    },
    listComments: async (input) => {
      calls.lists.push(input);
      const matching = comments.filter((comment) =>
        !input.search
        || comment.content.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())
        || comment.video.title.toLocaleLowerCase().includes(input.search.toLocaleLowerCase()));
      const start = (input.page - 1) * input.limit;
      return { comments: matching.slice(start, start + input.limit), total: matching.length };
    },
    deleteComment: async (input) => {
      calls.deletions.push(input);
      if (
        input.channelId !== CHANNEL_ID
        || input.userId !== USER_ID
        || input.commentId === FOREIGN_COMMENT_ID
      ) return false;
      const index = comments.findIndex((comment) => comment.id === input.commentId);
      if (index < 0) return false;
      comments.splice(index, 1);
      return true;
    },
  };

  const app = express();
  app.use('/api/v1/studio', createCreatorCommentsRouter({ authenticate, repository }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, comments, calls };
}

async function get(
  baseUrl: string,
  path: string,
  userId = USER_ID,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/studio${path}`, {
    headers: userId ? { 'x-test-user': userId } : {},
  });
}

async function remove(
  baseUrl: string,
  path: string,
  userId = USER_ID,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/studio${path}`, {
    method: 'DELETE',
    headers: userId ? { 'x-test-user': userId } : {},
  });
}

beforeEach(() => {
  activeServers = [];
});

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

test('an authenticated channel owner can list comments with author, video, and date data', async () => {
  const harness = await createHarness();
  const response = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments`);
  const body = await response.json() as {
    comments: JsonCreatorComment[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };

  assert.equal(response.status, 200);
  assert.equal(body.comments.length, 3);
  assert.equal(body.comments[0].user.channels[0].name, 'Author channel');
  assert.equal(body.comments[0].video.title, 'Video title');
  assert.equal(body.comments[0].createdAt, '2026-01-02T03:04:05.000Z');
  assert.equal(body.page, 1);
  assert.equal(body.limit, 20);
  assert.equal(body.total, 3);
  assert.equal(body.totalPages, 1);
  assert.deepEqual(harness.calls.ownership, [{ channelId: CHANNEL_ID, userId: USER_ID }]);
  assert.equal(harness.calls.lists[0].userId, USER_ID);
});

test('comment listing rejects unauthenticated users and channel non-owners', async () => {
  const harness = await createHarness();
  const anonymous = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments`, '');
  assert.equal(anonymous.status, 401);
  assert.equal(harness.calls.ownership.length, 0);

  const nonOwner = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments`, OTHER_USER_ID);
  assert.equal(nonOwner.status, 404);
  assert.equal(harness.calls.lists.length, 0);

  harness.calls.ownsChannel = false;
  const otherChannel = await get(harness.baseUrl, `/channels/${OTHER_CHANNEL_ID}/comments`);
  assert.equal(otherChannel.status, 404);
  assert.equal(harness.calls.lists.length, 0);
});

test('listing validates and forwards pagination and search filters', async () => {
  const harness = await createHarness();
  const response = await get(
    harness.baseUrl,
    `/channels/${CHANNEL_ID}/comments?page=2&limit=1&search=moderation`,
  );
  const body = await response.json() as {
    comments: JsonCreatorComment[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };

  assert.equal(response.status, 200);
  assert.equal(body.comments.length, 1);
  assert.equal(body.comments[0].id, COMMENT_TWO_ID);
  assert.equal(body.page, 2);
  assert.equal(body.limit, 1);
  assert.equal(body.total, 2);
  assert.equal(body.totalPages, 2);
  assert.deepEqual(harness.calls.lists[0], {
    channelId: CHANNEL_ID,
    userId: USER_ID,
    page: 2,
    limit: 1,
    search: 'moderation',
  });

  const invalidPage = await get(harness.baseUrl, `/channels/${CHANNEL_ID}/comments?page=0`);
  assert.equal(invalidPage.status, 400);
});

test('an empty comment result reports zero pages', async () => {
  const harness = await createHarness();
  const response = await get(
    harness.baseUrl,
    `/channels/${CHANNEL_ID}/comments?search=no-matching-comments`,
  );
  const body = await response.json() as {
    comments: JsonCreatorComment[];
    total: number;
    totalPages: number;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body.comments, []);
  assert.equal(body.total, 0);
  assert.equal(body.totalPages, 0);
});

test('an owner can permanently delete a comment only within the owned channel', async () => {
  const harness = await createHarness();
  const response = await remove(
    harness.baseUrl,
    `/channels/${CHANNEL_ID}/comments/${COMMENT_ONE_ID}`,
  );
  const body = await response.json() as { deleted: boolean; commentId: string };

  assert.equal(response.status, 200);
  assert.deepEqual(body, { deleted: true, commentId: COMMENT_ONE_ID });
  assert.equal(harness.comments.some((comment) => comment.id === COMMENT_ONE_ID), false);
  assert.deepEqual(harness.calls.deletions, [{
    channelId: CHANNEL_ID,
    commentId: COMMENT_ONE_ID,
    userId: USER_ID,
  }]);

  const nonOwner = await remove(
    harness.baseUrl,
    `/channels/${CHANNEL_ID}/comments/${COMMENT_TWO_ID}`,
    OTHER_USER_ID,
  );
  assert.equal(nonOwner.status, 404);
  assert.equal(harness.comments.some((comment) => comment.id === COMMENT_TWO_ID), true);
});

test('deletion validates IDs and cannot remove a comment belonging to another channel', async () => {
  const harness = await createHarness();
  const invalidId = await remove(
    harness.baseUrl,
    `/channels/${CHANNEL_ID}/comments/not-a-uuid`,
  );
  assert.equal(invalidId.status, 400);
  assert.equal(harness.calls.deletions.length, 0);

  const foreignComment = await remove(
    harness.baseUrl,
    `/channels/${CHANNEL_ID}/comments/${FOREIGN_COMMENT_ID}`,
  );
  assert.equal(foreignComment.status, 404);
  assert.equal(harness.calls.deletions.length, 1);
});
