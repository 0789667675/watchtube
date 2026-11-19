import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import express, { RequestHandler } from 'express';
import { afterEach, test } from 'node:test';
import { createPayoutRouter } from '../src/routes/wallet.route';

let activeServers: Server[] = [];

async function startServer() {
  const app = express();
  app.use(express.json());
  const authenticate: RequestHandler = (req, res, next) => {
    if (!req.get('x-test-user')) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
  app.use('/wallet/request-payout', createPayoutRouter(authenticate));

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

test('payout requests are authenticated and unavailable without writing a payout record', async () => {
  const baseUrl = await startServer();
  const path = `${baseUrl}/wallet/request-payout`;

  const unauthorized = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountCents: 50000, provider: 'MTN_MOMO', phoneNumber: '0781234567' }),
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': 'test-user' },
    body: JSON.stringify({ amountCents: 50000, provider: 'MTN_MOMO', phoneNumber: '0781234567' }),
  });
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: 'Payouts are unavailable until a verified payment-provider integration is configured.',
  });
});
