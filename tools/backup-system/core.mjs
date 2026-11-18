import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAGIC = Buffer.from('WTBK001\n', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_PREFIX_BYTES = MAGIC.length + NONCE_BYTES;

export async function createKeyFile(keyPath) {
  const key = randomBytes(32);
  const partialPath = `${keyPath}.partial-${randomUUID()}`;
  let handle;
  try {
    handle = await open(partialPath, 'wx', 0o600);
    await handle.writeFile(key);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await finalizeWithoutOverwrite(partialPath, keyPath);
  } catch (error) {
    if (handle) await handle.close();
    await rm(partialPath, { force: true });
    key.fill(0);
    throw error;
  }
  key.fill(0);
}

export async function loadKey(keyPath) {
  const key = await readFile(keyPath);
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('Backup key file must contain exactly 32 bytes.');
  }
  return key;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function redactedErrorMessage(error) {
  let message = error instanceof Error ? error.message : 'Unexpected operation failure.';
  const secretNames = [
    'DATABASE_URL',
    'PGPASSWORD',
    'REDIS_URL',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
    'RESTORE_S3_ACCESS_KEY_ID',
    'RESTORE_S3_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
  ];
  for (const name of secretNames) {
    const secret = process.env[name];
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message
    .replace(/((?:postgres(?:ql)?|redis):\/\/)[^/\s@]+@/gi, '$1[redacted]@')
    .replace(/(password|secret|token)=([^\s&]+)/gi, '$1=[redacted]');
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    sizeBytes += chunk.length;
    hash.update(chunk);
  }
  return { sizeBytes, sha256: hash.digest('hex') };
}

async function finalizeWithoutOverwrite(partialPath, finalPath) {
  await link(partialPath, finalPath);
  await rm(partialPath);
}

export async function encryptReadable(input, finalPath, key, options = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('A 32-byte backup key is required.');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const partialPath = `${finalPath}.partial-${randomUUID()}`;
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  let plainSizeBytes = 0;
  const plainHash = createHash('sha256');
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const hashInput = new Transform({
    transform(chunk, _encoding, callback) {
      plainSizeBytes += chunk.length;
      if (plainSizeBytes > maxBytes) {
        callback(new Error('Input exceeded the configured size limit.'));
        return;
      }
      plainHash.update(chunk);
      callback(null, chunk);
    },
  });
  const appendTag = new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk);
    },
    flush(callback) {
      this.push(cipher.getAuthTag());
      callback();
    },
  });

  await mkdir(path.dirname(finalPath), { recursive: true });
  const output = createWriteStream(partialPath, { flags: 'wx', mode: 0o600 });
  try {
    output.write(Buffer.concat([MAGIC, nonce]));
    await pipeline(input, hashInput, cipher, appendTag, output, options.signal
      ? { signal: options.signal }
      : {});
    if (plainSizeBytes === 0) {
      throw new Error('Empty data cannot be finalized as a backup artifact.');
    }
    const handle = await open(partialPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await finalizeWithoutOverwrite(partialPath, finalPath);
    const encrypted = await sha256File(finalPath);
    return {
      plainSizeBytes,
      plainSha256: plainHash.digest('hex'),
      encryptedSizeBytes: encrypted.sizeBytes,
      encryptedSha256: encrypted.sha256,
      nonceBytes: nonce.length,
      tagBytes: TAG_BYTES,
    };
  } catch (error) {
    output.destroy();
    await rm(partialPath, { force: true });
    throw error;
  } finally {
    nonce.fill(0);
  }
}

export async function decryptFile(encryptedPath, outputPath, key, expected = {}, options = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('A 32-byte backup key is required.');
  }
  const maxBytes = options.maxBytes ?? (typeof expected.plainSizeBytes === 'number'
    ? expected.plainSizeBytes
    : Number.POSITIVE_INFINITY);
  const encryptedStat = await stat(encryptedPath);
  const minimumSize = ENVELOPE_PREFIX_BYTES + TAG_BYTES + 1;
  if (encryptedStat.size < minimumSize) {
    throw new Error('Encrypted backup is empty or truncated.');
  }
  if (expected.encryptedSizeBytes !== undefined
      && encryptedStat.size !== expected.encryptedSizeBytes) {
    throw new Error('Encrypted backup size does not match the manifest.');
  }
  const encryptedHash = await sha256File(encryptedPath);
  if (expected.encryptedSha256 !== undefined
      && encryptedHash.sha256 !== expected.encryptedSha256) {
    throw new Error('Encrypted backup checksum does not match the manifest.');
  }

  const file = await open(encryptedPath, 'r');
  let prefix;
  let tag;
  try {
    prefix = Buffer.alloc(ENVELOPE_PREFIX_BYTES);
    tag = Buffer.alloc(TAG_BYTES);
    await file.read(prefix, 0, prefix.length, 0);
    await file.read(tag, 0, tag.length, encryptedStat.size - TAG_BYTES);
  } finally {
    await file.close();
  }
  if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Encrypted backup format marker is invalid.');
  }

  const nonce = prefix.subarray(MAGIC.length);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const outputHash = createHash('sha256');
  let outputSizeBytes = 0;
  const hashOutput = new Transform({
    transform(chunk, _encoding, callback) {
      outputSizeBytes += chunk.length;
      if (outputSizeBytes > maxBytes) {
        callback(new Error('Decrypted backup exceeded the configured size limit.'));
        return;
      }
      outputHash.update(chunk);
      callback(null, chunk);
    },
  });
  const partialPath = `${outputPath}.partial-${randomUUID()}`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  const output = createWriteStream(partialPath, { flags: 'wx', mode: 0o600 });
  try {
    await pipeline(
      createReadStream(encryptedPath, {
        start: ENVELOPE_PREFIX_BYTES,
        end: encryptedStat.size - TAG_BYTES - 1,
      }),
      decipher,
      hashOutput,
      output,
      options.signal ? { signal: options.signal } : {},
    );
    const plainSha256 = outputHash.digest('hex');
    if (expected.plainSizeBytes !== undefined
        && outputSizeBytes !== expected.plainSizeBytes) {
      throw new Error('Decrypted backup size does not match the manifest.');
    }
    if (expected.plainSha256 !== undefined
        && plainSha256 !== expected.plainSha256) {
      throw new Error('Decrypted backup checksum does not match the manifest.');
    }
    const handle = await open(partialPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await finalizeWithoutOverwrite(partialPath, outputPath);
    return { plainSizeBytes: outputSizeBytes, plainSha256 };
  } catch (error) {
    output.destroy();
    await rm(partialPath, { force: true });
    throw error;
  } finally {
    prefix.fill(0);
    tag.fill(0);
  }
}

export async function verifyEncryptedFile(encryptedPath, key, expected = {}, options = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('A 32-byte backup key is required.');
  }
  const maxBytes = options.maxBytes ?? (typeof expected.plainSizeBytes === 'number'
    ? expected.plainSizeBytes
    : Number.POSITIVE_INFINITY);
  const encryptedStat = await stat(encryptedPath);
  if (encryptedStat.size < ENVELOPE_PREFIX_BYTES + TAG_BYTES + 1) {
    throw new Error('Encrypted backup is empty or truncated.');
  }
  const encryptedHash = await sha256File(encryptedPath);
  if (expected.encryptedSizeBytes !== undefined
      && encryptedStat.size !== expected.encryptedSizeBytes) {
    throw new Error('Encrypted backup size does not match the manifest.');
  }
  if (expected.encryptedSha256 !== undefined
      && encryptedHash.sha256 !== expected.encryptedSha256) {
    throw new Error('Encrypted backup checksum does not match the manifest.');
  }
  const file = await open(encryptedPath, 'r');
  const prefix = Buffer.alloc(ENVELOPE_PREFIX_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await file.read(prefix, 0, prefix.length, 0);
    await file.read(tag, 0, tag.length, encryptedStat.size - TAG_BYTES);
  } finally {
    await file.close();
  }
  if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Encrypted backup format marker is invalid.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    prefix.subarray(MAGIC.length),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAuthTag(tag);
  const plainHash = createHash('sha256');
  let plainSizeBytes = 0;
  const inspect = new Transform({
    transform(chunk, _encoding, callback) {
      plainSizeBytes += chunk.length;
      if (plainSizeBytes > maxBytes) {
        callback(new Error('Decrypted backup exceeded the configured size limit.'));
        return;
      }
      plainHash.update(chunk);
      callback(null, chunk);
    },
  });
  const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  try {
    await pipeline(
      createReadStream(encryptedPath, {
        start: ENVELOPE_PREFIX_BYTES,
        end: encryptedStat.size - TAG_BYTES - 1,
      }),
      decipher,
      inspect,
      sink,
      options.signal ? { signal: options.signal } : {},
    );
    const plainSha256 = plainHash.digest('hex');
    if (expected.plainSizeBytes !== undefined
        && plainSizeBytes !== expected.plainSizeBytes) {
      throw new Error('Decrypted backup size does not match the manifest.');
    }
    if (expected.plainSha256 !== undefined
        && plainSha256 !== expected.plainSha256) {
      throw new Error('Decrypted backup checksum does not match the manifest.');
    }
    return {
      plainSizeBytes,
      plainSha256,
      encryptedSizeBytes: encryptedStat.size,
      encryptedSha256: encryptedHash.sha256,
    };
  } finally {
    prefix.fill(0);
    tag.fill(0);
  }
}

export async function assertPathOutside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Backup key and backup destination must be separate.');
  }
}

export function isWithin(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function writeJsonNew(filePath, value) {
  const partialPath = `${filePath}.partial-${randomUUID()}`;
  let handle;
  try {
    handle = await open(partialPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await finalizeWithoutOverwrite(partialPath, filePath);
  } catch (error) {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
    await rm(partialPath, { force: true });
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

