import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { decryptFile } from '../core.mjs';
import { backupMedia, inventoryMedia, listObjects } from '../storage.mjs';

const objectKey = 'uploads/123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174001';

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'watchtube-storage-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('R2 inventory paginates, totals sizes, and does not expose object keys', async () => {
  const responses = [
    {
      Contents: [{ Key: objectKey, Size: 7 }, { Key: 'media/video/segment.ts', Size: 19 }],
      IsTruncated: true,
      NextContinuationToken: 'next-page',
    },
    { Contents: [{ Key: 'root-object', Size: 2 }], IsTruncated: false },
  ];
  const requestTokens = [];
  const client = {
    async send(command) {
      requestTokens.push(command.input.ContinuationToken);
      return responses.shift();
    },
  };
  const inventory = await inventoryMedia(client, ['synthetic-bucket']);
  assert.equal(inventory[0].objectCount, 3);
  assert.equal(inventory[0].totalBytes, 28);
  assert.equal(inventory[0].largestObjects[0].sizeBytes, 19);
  assert.equal(requestTokens[0], undefined);
  assert.equal(requestTokens[1], 'next-page');
  assert.equal(JSON.stringify(inventory).includes(objectKey), false);
  assert.equal(JSON.stringify(inventory).includes('123e4567-e89b-42d3-a456-426614174000'), false);
});

test('R2 backup streams and encrypts objects using hashed local names', async () => {
  await withTempDir(async (runDir) => {
    const key = randomBytes(32);
    const content = Buffer.from('synthetic media object');
    let listingComplete = false;
    const client = {
      async send(command) {
        if (command.constructor.name === 'ListObjectsV2Command') {
          if (listingComplete) return { Contents: [], IsTruncated: false };
          listingComplete = true;
          return {
            Contents: [{ Key: objectKey, Size: content.length, ETag: '"synthetic-etag"' }],
            IsTruncated: false,
          };
        }
        assert.equal(command.constructor.name, 'GetObjectCommand');
        return {
          Body: Readable.from(content),
          ContentLength: content.length,
          ETag: '"synthetic-etag"',
        };
      },
    };
    const records = [];
    const summaries = await backupMedia(
      client,
      runDir,
      key,
      ['synthetic-bucket'],
      async (record) => records.push(record),
    );
    assert.deepEqual(summaries, [{
      bucket: 'synthetic-bucket',
      objectCount: 1,
      totalBytes: content.length,
    }]);
    assert.equal(records.length, 1);
    assert.equal(records[0].type, 'media-object');
    assert.equal(records[0].key, objectKey);
    assert.equal(records[0].relativePath.includes(objectKey), false);
    const encryptedPath = path.join(runDir, ...records[0].relativePath.split('/'));
    const restoredPath = path.join(runDir, 'restored-object');
    await decryptFile(encryptedPath, restoredPath, key, records[0]);
    assert.deepEqual(await readFile(restoredPath), content);
    key.fill(0);
  });
});

test('a truncated listing without a continuation token is rejected', async () => {
  const client = {
    async send() { return { Contents: [], IsTruncated: true }; },
  };
  await assert.rejects(async () => {
    for await (const _object of listObjects(client, 'synthetic-bucket')) {
      assert.fail('Unexpected object.');
    }
  }, /continuation token/);
});
