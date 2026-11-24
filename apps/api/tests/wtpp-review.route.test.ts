import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { requireAdmin } from '../src/middleware/admin';
import {
  createWtppReviewRouter,
  WtppReviewRepository,
} from '../src/routes/wtpp-review.route';

const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
let activeServers: Server[] = [];

function createRepository() {
  let status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING';
  let reviewerNotes: string | null = null;
  const reviewedAt = null;
  const repository: WtppReviewRepository = {
    async reviewPendingApplication(input) {
      if (status !== 'PENDING') return null;
      status = input.status;
      reviewerNotes = input.reviewerNotes;
      return Object.assign(
        { id: input.applicationId, status, reviewerNotes, reviewedAt },
        { taxId: 'private-tax-id', nationalIdOrPassport: 'private-identity-document' },
      );
    },
  };
  return { repository, getStatus: () => status };
}

async function startServer(repository: WtppReviewRepository) {
  const app = express();
  app.use(express.json());
  const testIdentity: RequestHandler = (req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) return res.status(401).json({ error: 'Unauthorized' });
    (req as express.Request & { user?: { id: string; role: string } }).user = {
      id: '22222222-2222-4222-8222-222222222222',
      role,
    };
    next();
  };
  app.use('/admin', testIdentity, requireAdmin, createWtppReviewRouter(repository));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  activeServers = [];
});

test('only administrators and moderators may review a pending application', async () => {
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const path = `${baseUrl}/admin/${APPLICATION_ID}`;

  const unauthorized = await fetch(path, { method: 'PATCH' });
  assert.equal(unauthorized.status, 401);
  const viewer = await fetch(path, {
    method: 'PATCH',
    headers: { 'x-test-role': 'VIEWER', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED' }),
  });
  assert.equal(viewer.status, 403);
  assert.equal(state.getStatus(), 'PENDING');

  const moderator = await fetch(path, {
    method: 'PATCH',
    headers: { 'x-test-role': 'MODERATOR', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED' }),
  });
  assert.equal(moderator.status, 200);
  assert.equal((await moderator.json() as { status: string }).status, 'APPROVED');
});

test('rejection requires a reason and only pending applications can be reviewed', async () => {
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const path = `${baseUrl}/admin/${APPLICATION_ID}`;
  const headers = { 'x-test-role': 'ADMIN', 'content-type': 'application/json' };

  const missingReason = await fetch(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'REJECTED' }),
  });
  assert.equal(missingReason.status, 400);
  assert.equal(state.getStatus(), 'PENDING');

  const rejected = await fetch(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'REJECTED', reviewerNotes: 'Please verify channel ownership.' }),
  });
  assert.equal(rejected.status, 200);
  assert.deepEqual(await rejected.json(), {
    id: APPLICATION_ID,
    status: 'REJECTED',
    reviewerNotes: 'Please verify channel ownership.',
    reviewedAt: null,
  });

  const repeatedReview = await fetch(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'APPROVED' }),
  });
  assert.equal(repeatedReview.status, 409);
});
