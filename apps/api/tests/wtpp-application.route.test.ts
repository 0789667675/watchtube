import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import {
  createWtppApplicationRouter,
  WtppApplicationRepository,
} from '../src/routes/trust.route';
import { decryptWtppPii } from '../src/security/wtppPii';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
let activeServers: Server[] = [];
const previousEncryptionKey = process.env.WTPP_PII_ENCRYPTION_KEY;

async function startServer(repository: WtppApplicationRepository) {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    (req as express.Request & { user?: { id: string } }).user = { id: userId };
    next();
  };
  app.use('/api/v1', createWtppApplicationRouter(authenticate, repository));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function createRepository() {
  let application: { status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewerNotes: string | null; reviewedAt: Date | null } | null = null;
  let submitCount = 0;
  let submittedInput: unknown;
  const repository: WtppApplicationRepository = {
    async findCreatorChannel(userId, channelId) {
      return userId === USER_ID && (!channelId || channelId === CHANNEL_ID)
        ? { id: CHANNEL_ID, name: 'Creator', handle: '@creator', subscriberCount: 0, isMonetized: false }
        : null;
    },
    async findApplication() {
      return application;
    },
    async getChannelWatchHours() {
      return 0;
    },
    async submitApplication(input) {
      if (application && application.status !== 'REJECTED') return null;
      submittedInput = input;
      submitCount += 1;
      application = { status: 'PENDING', reviewerNotes: null, reviewedAt: null };
      return application;
    },
  };
  return {
    repository,
    setRejected() {
      application = { status: 'REJECTED', reviewerNotes: 'Correct the issue.', reviewedAt: new Date() };
    },
    getSubmitCount: () => submitCount,
    getSubmittedInput: () => submittedInput,
  };
}

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  activeServers = [];
  if (previousEncryptionKey === undefined) delete process.env.WTPP_PII_ENCRYPTION_KEY;
  else process.env.WTPP_PII_ENCRYPTION_KEY = previousEncryptionKey;
});

test('creators below legacy thresholds may apply and repeat applications after rejection', async () => {
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const headers = { 'content-type': 'application/json', 'x-test-user': USER_ID };

  const statusResponse = await fetch(`${baseUrl}/api/v1/wtpp/status?channelId=${CHANNEL_ID}`, { headers });
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    channelId: CHANNEL_ID,
    channelName: 'Creator',
    channelHandle: '@creator',
    isMonetized: false,
    applicationStatus: 'NOT_APPLIED',
    canApply: true,
    reviewerNotes: null,
    reviewedAt: null,
  });

  const firstApplication = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ channelId: CHANNEL_ID }),
  });
  assert.equal(firstApplication.status, 201);
  assert.equal((await firstApplication.json() as { status: string }).status, 'PENDING');
  assert.deepEqual(state.getSubmittedInput(), {
    channelId: CHANNEL_ID,
    channelWatchHours: 0,
    subscriberCount: 0,
  });

  const duplicate = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ channelId: CHANNEL_ID }),
  });
  assert.equal(duplicate.status, 409);

  state.setRejected();
  const reapplication = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ channelId: CHANNEL_ID }),
  });
  assert.equal(reapplication.status, 201);
  assert.equal((await reapplication.json() as { status: string }).status, 'PENDING');
  assert.equal(state.getSubmitCount(), 2);
});

test('WTPP routes require authentication and only find the signed-in creator channel', async () => {
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const unauthorized = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorized.status, 401);

  const missingChannel = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': '33333333-3333-4333-8333-333333333333' },
    body: '{}',
  });
  assert.equal(missingChannel.status, 404);
  assert.equal(state.getSubmitCount(), 0);

  const unownedChannel = await fetch(`${baseUrl}/api/v1/wtpp/status?channelId=44444444-4444-4444-8444-444444444444`, {
    headers: { 'x-test-user': USER_ID },
  });
  assert.equal(unownedChannel.status, 404);
});

test('WTPP identity fields are encrypted before persistence and omitted from responses', async () => {
  process.env.WTPP_PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const headers = { 'content-type': 'application/json', 'x-test-user': USER_ID };

  const response = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      channelId: CHANNEL_ID,
      taxId: 'private-tax-id',
      nationalIdOrPassport: 'private-identity-document',
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: 'PENDING',
    reviewerNotes: null,
    reviewedAt: null,
  });
  const stored = state.getSubmittedInput() as {
    taxId: string;
    nationalIdOrPassport: string;
  };
  assert.notEqual(stored.taxId, 'private-tax-id');
  assert.notEqual(stored.nationalIdOrPassport, 'private-identity-document');
  assert.equal(decryptWtppPii(stored.taxId, 'taxId'), 'private-tax-id');
  assert.equal(
    decryptWtppPii(stored.nationalIdOrPassport, 'nationalIdOrPassport'),
    'private-identity-document',
  );
});

test('WTPP identity submission fails closed when encryption is not configured', async () => {
  delete process.env.WTPP_PII_ENCRYPTION_KEY;
  const state = createRepository();
  const baseUrl = await startServer(state.repository);
  const response = await fetch(`${baseUrl}/api/v1/wtpp/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': USER_ID },
    body: JSON.stringify({ channelId: CHANNEL_ID, taxId: 'private-tax-id' }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Sensitive identity encryption is not configured.',
  });
  assert.equal(state.getSubmitCount(), 0);
});
