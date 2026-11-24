import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { createChannelRouter, ChannelRepository, ChannelSettings } from '../src/routes/channel.route';

let activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
  activeServers = [];
});

async function startServer(repo: Partial<ChannelRepository>, userId = '11111111-1111-4111-8111-111111111111') {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, _res, next) => {
    (req as any).user = { id: userId, role: 'USER' };
    next();
  };

  const defaultRepo: ChannelRepository = {
    async createChannel(input) {
      return {
        id: '22222222-2222-4222-8222-222222222222',
        name: input.name,
        handle: input.handle,
        description: input.description ?? null,
        avatarUrl: null,
        bannerUrl: null,
      };
    },
    async findPublicChannel() { return null; },
    async findOwnedChannel() { return null; },
    async handleExists() { return false; },
    async updateOwnedChannel() { return null; },
    ...repo,
  };

  app.use('/channels', createChannelRouter({ authenticate, repository: defaultRepo }));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/channels`;
}

test('Channel uniqueness: successfully creates first channel for user with unique handle', async () => {
  const url = await startServer({
    hasUserChannel: async () => false,
    handleExists: async () => false,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'First Channel', handle: '@first_chan' }),
  });

  assert.equal(res.status, 201);
  const data = await res.json() as ChannelSettings;
  assert.equal(data.name, 'First Channel');
  assert.equal(data.handle, '@first_chan');
});

test('Channel uniqueness: rejects creation with 409 when user already owns a channel', async () => {
  const url = await startServer({
    hasUserChannel: async () => true,
    handleExists: async () => false,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Second Channel Attempt', handle: '@second_chan' }),
  });

  assert.equal(res.status, 409);
  const data = await res.json() as { error: string };
  assert.equal(data.error, 'Each account may only have one channel.');
});

test('Channel uniqueness: handles race-condition P2002 on userId with 409 account channel error', async () => {
  const p2002Error = new Error('Unique constraint failed on the fields: (`userId`)');
  (p2002Error as any).code = 'P2002';
  (p2002Error as any).meta = { target: ['userId'] };

  const url = await startServer({
    hasUserChannel: async () => false,
    handleExists: async () => false,
    createChannel: async () => { throw p2002Error; },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Race Channel', handle: '@race_chan' }),
  });

  assert.equal(res.status, 409);
  const data = await res.json() as { error: string };
  assert.equal(data.error, 'Each account may only have one channel.');
});

test('Channel uniqueness: handles duplicate handle with 409 handle already in use', async () => {
  const url = await startServer({
    hasUserChannel: async () => false,
    handleExists: async () => true,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dup Handle', handle: '@taken_handle' }),
  });

  assert.equal(res.status, 409);
  const data = await res.json() as { error: string };
  assert.equal(data.error, 'Handle already in use.');
});
