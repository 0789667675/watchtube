import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import {
  assertPathOutside,
  createKeyFile,
  decryptFile,
  encryptReadable,
  isWithin,
  loadKey,
  sha256,
  verifyEncryptedFile,
  writeJsonNew,
} from '../core.mjs';

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'watchtube-backup-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('key files are create-only and contain 32 random bytes', async () => {
  await withTempDir(async (directory) => {
    const keyPath = path.join(directory, 'backup.key');
    await createKeyFile(keyPath);
    const key = await loadKey(keyPath);
    assert.equal(key.length, 32);
    key.fill(0);
    await assert.rejects(createKeyFile(keyPath), { code: 'EEXIST' });
  });
});

test('encrypted stream round-trips and validates both checksums', async () => {
  await withTempDir(async (directory) => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('synthetic backup content'.repeat(1024));
    const sourcePath = path.join(directory, 'source');
    const encryptedPath = path.join(directory, 'archive.wtbk');
    const restoredPath = path.join(directory, 'restored');
    await writeFile(sourcePath, plaintext, { flag: 'wx' });
    const metadata = await encryptReadable(
      createReadStream(sourcePath),
      encryptedPath,
      key,
    );
    const verified = await verifyEncryptedFile(encryptedPath, key, metadata);
    assert.equal(verified.plainSizeBytes, plaintext.length);
    assert.equal(metadata.plainSizeBytes, plaintext.length);
    assert.equal(metadata.plainSha256, sha256(plaintext));
    const restored = await decryptFile(encryptedPath, restoredPath, key, metadata);
    assert.equal(restored.plainSha256, sha256(plaintext));
    assert.deepEqual(await readFile(restoredPath), plaintext);
    await assert.rejects(
      encryptReadable(createReadStream(sourcePath), encryptedPath, key),
      { code: 'EEXIST' },
    );
    key.fill(0);
  });
});

test('wrong keys and modified ciphertext fail authentication without finalizing plaintext', async () => {
  await withTempDir(async (directory) => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const sourcePath = path.join(directory, 'source');
    const encryptedPath = path.join(directory, 'archive.wtbk');
    const restoredPath = path.join(directory, 'restored');
    await writeFile(sourcePath, 'synthetic data', { flag: 'wx' });
    const metadata = await encryptReadable(createReadStream(sourcePath), encryptedPath, key);
    await assert.rejects(decryptFile(encryptedPath, restoredPath, wrongKey, metadata));
    await assert.rejects(readFile(restoredPath), { code: 'ENOENT' });
    const corrupted = await readFile(encryptedPath);
    corrupted[corrupted.length - 17] ^= 1;
    await writeFile(encryptedPath, corrupted);
    await assert.rejects(decryptFile(encryptedPath, restoredPath, key, metadata));
    await assert.rejects(readFile(restoredPath), { code: 'ENOENT' });
    key.fill(0);
    wrongKey.fill(0);
  });
});

test('empty, over-limit, and interrupted inputs are never finalized', async () => {
  await withTempDir(async (directory) => {
    const key = randomBytes(32);
    const emptyPath = path.join(directory, 'empty.wtbk');
    const oversizedPath = path.join(directory, 'oversized.wtbk');
    const interruptedPath = path.join(directory, 'interrupted.wtbk');
    const emptySource = path.join(directory, 'empty');
    await writeFile(emptySource, '', { flag: 'wx' });
    await assert.rejects(encryptReadable(createReadStream(emptySource), emptyPath, key));
    const sourcePath = path.join(directory, 'source');
    await writeFile(sourcePath, 'more than four bytes', { flag: 'wx' });
    await assert.rejects(
      encryptReadable(createReadStream(sourcePath), oversizedPath, key, { maxBytes: 4 }),
    );
    const { Readable } = await import('node:stream');
    const broken = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('synthetic interruption'));
      },
    });
    await assert.rejects(encryptReadable(broken, interruptedPath, key));
    for (const candidate of [emptyPath, oversizedPath, interruptedPath]) {
      await assert.rejects(readFile(candidate), { code: 'ENOENT' });
    }
    key.fill(0);
  });
});

test('abort signals leave no finalized encrypted artifact', async () => {
  await withTempDir(async (directory) => {
    const key = randomBytes(32);
    const outputPath = path.join(directory, 'cancelled.wtbk');
    const input = new PassThrough();
    const controller = new AbortController();
    const timer = setInterval(() => input.write(Buffer.alloc(1024, 7)), 5);
    input.on('close', () => clearInterval(timer));
    const encryption = encryptReadable(input, outputPath, key, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('synthetic interruption')), 30);
    await assert.rejects(encryption);
    await assert.rejects(readFile(outputPath), { code: 'ENOENT' });
    key.fill(0);
  });
});

test('backup key paths must be outside the backup root', async () => {
  const root = path.resolve('backup-root');
  await assert.rejects(assertPathOutside(root, path.join(root, 'key')));
  await assert.doesNotReject(assertPathOutside(root, path.resolve('key-material', 'backup.key')));
  assert.equal(isWithin(root, path.join(root, 'run')), true);
  assert.equal(isWithin(root, path.resolve('other')), false);
});

test('manifest plaintext size limits stop oversized decryption before finalization', async () => {
  await withTempDir(async (directory) => {
    const key = randomBytes(32);
    const sourcePath = path.join(directory, 'source');
    const encryptedPath = path.join(directory, 'archive.wtbk');
    const restoredPath = path.join(directory, 'restored');
    await writeFile(sourcePath, 'synthetic plaintext longer than the declared limit', { flag: 'wx' });
    const metadata = await encryptReadable(createReadStream(sourcePath), encryptedPath, key);
    await assert.rejects(
      decryptFile(
        encryptedPath,
        restoredPath,
        key,
        { ...metadata, plainSizeBytes: 4 },
        { maxBytes: 4 },
      ),
      /exceeded the configured size limit/,
    );
    await assert.rejects(readFile(restoredPath), { code: 'ENOENT' });
    await assert.rejects(
      verifyEncryptedFile(
        encryptedPath,
        key,
        { ...metadata, plainSizeBytes: 4 },
        { maxBytes: 4 },
      ),
      /exceeded the configured size limit/,
    );
    key.fill(0);
  });
});

test('completion JSON is create-only and leaves existing files untouched', async () => {
  await withTempDir(async (directory) => {
    const markerPath = path.join(directory, '.complete');
    await writeJsonNew(markerPath, { format: 1 });
    assert.deepEqual(JSON.parse(await readFile(markerPath, 'utf8')), { format: 1 });
    await assert.rejects(writeJsonNew(markerPath, { format: 2 }));
    assert.deepEqual(await readdir(directory), ['.complete']);

    await rm(markerPath);
    await writeFile(markerPath, 'existing marker', { flag: 'wx' });
    await assert.rejects(writeJsonNew(markerPath, { format: 1 }));
    assert.equal(await readFile(markerPath, 'utf8'), 'existing marker');
    assert.deepEqual(await readdir(directory), ['.complete']);
  });
});

test('failed completion serialization leaves no marker or partial file', async () => {
  await withTempDir(async (directory) => {
    const markerPath = path.join(directory, '.complete');
    await assert.rejects(writeJsonNew(markerPath, { value: 1n }), /serialize a BigInt/);
    assert.deepEqual(await readdir(directory), []);
  });
});
