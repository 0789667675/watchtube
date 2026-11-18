import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, realpath, readdir, rm, statfs } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import {
  assertPathOutside,
  createKeyFile,
  decryptFile,
  encryptReadable,
  isWithin,
  loadKey,
  redactedErrorMessage,
  readJson,
  verifyEncryptedFile,
  writeJsonNew,
} from './core.mjs';
import {
  dumpDatabase,
  getPostgresClientVersions,
  inspectDatabase,
  parseDatabaseUrl,
  runPgCommand,
  runPgRestoreList,
} from './postgres.mjs';
import {
  backupMedia,
  createSourceClient,
  inventoryMedia,
  mirrorBackup,
  restoreMediaObjects,
  sourceBuckets,
} from './storage.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENCRYPTED_MANIFEST = 'manifest.jsonl.wtbk';
const COMPLETE_MARKER = '.complete';
const MINIMUM_FREE_BYTES = 256 * 1024 * 1024;

function absoluteEnvPath(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  return path.resolve(value);
}

async function backupRoot() {
  const configured = absoluteEnvPath('WATCHTUBE_BACKUP_ROOT');
  let configuredStat;
  try {
    configuredStat = await lstat(configured);
  } catch {
    throw new Error('WATCHTUBE_BACKUP_ROOT must already exist and be accessible.');
  }
  if (!configuredStat.isDirectory() || configuredStat.isSymbolicLink()) {
    throw new Error('WATCHTUBE_BACKUP_ROOT must be a real directory, not a symbolic link.');
  }
  let root;
  try {
    root = await realpath(configured);
  } catch {
    throw new Error('WATCHTUBE_BACKUP_ROOT must already exist and be accessible.');
  }
  const repo = await realpath(REPO_ROOT);
  if (root === repo || isWithin(repo, root)) {
    throw new Error('Backup destination must be outside the project repository.');
  }
  const details = await lstat(root);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('WATCHTUBE_BACKUP_ROOT must be a real directory, not a symbolic link.');
  }
  return root;
}

async function backupContext() {
  const root = await backupRoot();
  const configuredKey = absoluteEnvPath('WATCHTUBE_BACKUP_KEY_FILE');
  let configuredKeyStat;
  try {
    configuredKeyStat = await lstat(configuredKey);
  } catch {
    throw new Error('WATCHTUBE_BACKUP_KEY_FILE must refer to an existing key file.');
  }
  if (!configuredKeyStat.isFile() || configuredKeyStat.isSymbolicLink()) {
    throw new Error('Backup key must be a regular file, not a symbolic link.');
  }
  let keyPath;
  try {
    keyPath = await realpath(configuredKey);
  } catch {
    throw new Error('WATCHTUBE_BACKUP_KEY_FILE must refer to an existing key file.');
  }
  const repo = await realpath(REPO_ROOT);
  await assertPathOutside(root, keyPath);
  await assertPathOutside(repo, keyPath);
  const keyStat = await lstat(keyPath);
  if (!keyStat.isFile() || keyStat.isSymbolicLink()) {
    throw new Error('Backup key must be a regular file, not a symbolic link.');
  }
  return { root, key: await loadKey(keyPath) };
}

async function validateNewKeyPath(keyPath) {
  const repo = await realpath(REPO_ROOT);
  await assertPathOutside(repo, path.resolve(keyPath));
  if (process.env.WATCHTUBE_BACKUP_ROOT) {
    const root = await backupRoot();
    await assertPathOutside(root, path.resolve(keyPath));
  }
  const parent = await realpath(path.dirname(path.resolve(keyPath)));
  await assertPathOutside(repo, path.join(parent, path.basename(keyPath)));
}

async function createRunDirectory(root) {
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const runDir = path.join(root, runId);
  await mkdir(runDir, { recursive: false, mode: 0o700 });
  return { runId, runDir };
}

async function ensureCapacity(root, requiredBytes) {
  let disk;
  try {
    disk = await statfs(root);
  } catch {
    throw new Error('Could not verify free space at the backup destination; backup was not started.');
  }
  const availableBytes = Number(disk.bavail) * Number(disk.bsize);
  const required = Math.ceil(requiredBytes * 1.1) + MINIMUM_FREE_BYTES;
  if (!Number.isFinite(availableBytes) || availableBytes < required) {
    throw new Error('Insufficient verified free space for the estimated backup and safety reserve.');
  }
  return { availableBytes, estimatedRequiredBytes: required };
}

function createManifestWriter(runDir, key, signal) {
  const stream = new PassThrough();
  const filePath = path.join(runDir, ENCRYPTED_MANIFEST);
  const encryption = encryptReadable(stream, filePath, key, { signal });
  encryption.catch(() => {});
  let records = 0;
  return {
    async write(record) {
      const line = `${JSON.stringify(record)}\n`;
      if (!stream.write(line)) await once(stream, 'drain');
      records += 1;
    },
    async finish() {
      stream.end();
      const metadata = await encryption;
      return { metadata, records };
    },
    abort() {
      stream.destroy();
    },
  };
}

async function completeRun(runDir, runId, manifest) {
  await writeJsonNew(path.join(runDir, COMPLETE_MARKER), {
    format: 1,
    runId,
    completedAt: new Date().toISOString(),
    manifestEncryptedSizeBytes: manifest.metadata.encryptedSizeBytes,
    manifestEncryptedSha256: manifest.metadata.encryptedSha256,
    manifestRecords: manifest.records,
  });
}

async function maybeMirror(runDir, runId, signal) {
  const mirrorKeys = [
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
    'BACKUP_S3_BUCKET',
  ];
  const configured = mirrorKeys.some((name) => Boolean(process.env[name]));
  if (!configured) return null;
  if (!mirrorKeys.every((name) => Boolean(process.env[name]))) {
    throw new Error('Remote backup destination configuration is incomplete.');
  }
  return mirrorBackup(runDir, runId, signal);
}

async function createBackup({ includeDatabase, includeMedia }, signal) {
  const { root, key } = await backupContext();
  let sourceClient;
  let run;
  let manifestWriter;
  try {
    const postgresClientVersions = includeDatabase ? await getPostgresClientVersions() : null;
    const databaseInventory = includeDatabase ? await inspectDatabase(undefined, signal) : null;
    const buckets = includeMedia ? sourceBuckets() : [];
    const mediaInventory = includeMedia
      ? await inventoryMedia((sourceClient = createSourceClient()), buckets, signal)
      : [];
    const estimatedDatabaseBytes = databaseInventory?.databaseSizeBytes || 0;
    const estimatedMediaBytes = mediaInventory.reduce((sum, item) => sum + item.totalBytes, 0);
    const capacity = await ensureCapacity(
      root,
      Math.ceil(estimatedDatabaseBytes * 1.5) + Math.ceil(estimatedMediaBytes * 1.05),
    );
    run = await createRunDirectory(root);
    manifestWriter = createManifestWriter(run.runDir, key, signal);
    const startedAt = new Date().toISOString();
    await manifestWriter.write({
      type: 'run',
      format: 1,
      runId: run.runId,
      startedAt,
      databaseIncluded: includeDatabase,
      mediaIncluded: includeMedia,
      postgresClientVersions,
    });
    if (databaseInventory) {
      await manifestWriter.write({ type: 'database-inventory', inventory: databaseInventory });
      const databasePath = path.join(run.runDir, 'database.pgcustom.wtbk');
      const databaseArtifact = await dumpDatabase(
        process.env.DATABASE_URL,
        databasePath,
        key,
        'database',
        signal,
      );
      await manifestWriter.write({
        type: 'database',
        relativePath: path.basename(databasePath),
        createdAt: new Date().toISOString(),
        ...databaseArtifact,
      });
      let globals = { status: 'not-attempted' };
      try {
        const globalsPath = path.join(run.runDir, 'postgres-globals.sql.wtbk');
        const globalArtifact = await dumpDatabase(
          process.env.DATABASE_URL,
          globalsPath,
          key,
          'globals',
          signal,
        );
        globals = {
          status: 'captured',
          relativePath: path.basename(globalsPath),
          ...globalArtifact,
        };
      } catch (error) {
        globals = { status: 'unavailable', reason: safeErrorMessage(error) };
      }
      await manifestWriter.write({ type: 'postgres-globals', ...globals });
    }
    let mediaSummaries = [];
    if (includeMedia) {
      await manifestWriter.write({ type: 'media-inventory', inventory: mediaInventory });
      mediaSummaries = await backupMedia(
        sourceClient,
        run.runDir,
        key,
        buckets,
        (record) => manifestWriter.write(record),
        signal,
      );
      for (let index = 0; index < mediaInventory.length; index += 1) {
        if (mediaInventory[index].objectCount !== mediaSummaries[index]?.objectCount
            || mediaInventory[index].totalBytes !== mediaSummaries[index]?.totalBytes) {
          throw new Error(`Object inventory changed during backup for bucket ${mediaInventory[index].bucket}.`);
        }
      }
      await manifestWriter.write({ type: 'media-summary', summaries: mediaSummaries });
    }
    await manifestWriter.write({
      type: 'run-complete',
      completedAt: new Date().toISOString(),
      estimatedCapacity: capacity,
    });
    const manifest = await manifestWriter.finish();
    await completeRun(run.runDir, run.runId, manifest);
    const mirror = await maybeMirror(run.runDir, run.runId, signal);
    return {
      runId: run.runId,
      localPath: run.runDir,
      databaseSizeBytes: databaseInventory?.databaseSizeBytes ?? null,
      mediaObjectCount: mediaSummaries.reduce((sum, item) => sum + item.objectCount, 0),
      mediaBytes: mediaSummaries.reduce((sum, item) => sum + item.totalBytes, 0),
      manifestRecords: manifest.records,
      remoteMirror: mirror ? { bucket: mirror.bucket, prefix: mirror.prefix, fileCount: mirror.fileCount } : null,
      note: 'Local backup finalized; restore verification must be run separately.',
    };
  } catch (error) {
    manifestWriter?.abort();
    throw error;
  } finally {
    sourceClient?.destroy();
    key.fill(0);
  }
}

function validateRelativePath(runDir, relativePath) {
  if (typeof relativePath !== 'string' || path.posix.isAbsolute(relativePath)
      || relativePath.includes('\\')) {
    throw new Error('Backup manifest contains an invalid artifact path.');
  }
  const fullPath = path.resolve(runDir, ...relativePath.split('/'));
  if (!isWithin(runDir, fullPath) || fullPath === runDir) {
    throw new Error('Backup manifest artifact path escapes the backup directory.');
  }
  return fullPath;
}

async function* readManifest(runDir, key, marker, signal) {
  const manifestPath = path.join(runDir, ENCRYPTED_MANIFEST);
  const manifestTemp = path.join(os.tmpdir(), `watchtube-manifest-${randomUUID()}.jsonl`);
  try {
    const stat = await lstat(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Encrypted manifest is not a regular file.');
    }
    await decryptFile(manifestPath, manifestTemp, key, {
      encryptedSizeBytes: marker.manifestEncryptedSizeBytes,
      encryptedSha256: marker.manifestEncryptedSha256,
    }, { signal });
    let records = 0;
    const lines = createInterface({ input: createReadStream(manifestTemp), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new Error('Decrypted backup manifest contains an invalid record.');
      }
      records += 1;
      yield record;
    }
    if (records !== marker.manifestRecords) {
      throw new Error('Backup manifest record count does not match the completion marker.');
    }
  } finally {
    await rm(manifestTemp, { force: true });
  }
}

async function openRun(root, runId) {
  if (!runId || path.basename(runId) !== runId || !/^run-[A-Za-z0-9-]+$/.test(runId)) {
    throw new Error('A valid backup run ID is required.');
  }
  const runDir = path.resolve(root, runId);
  if (!isWithin(root, runDir) || runDir === root) {
    throw new Error('Backup run path is invalid.');
  }
  const details = await lstat(runDir);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('Backup run path must be a regular directory.');
  }
  const markerPath = path.join(runDir, COMPLETE_MARKER);
  const markerStat = await lstat(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error('Backup run has no valid completion marker.');
  }
  const marker = await readJson(markerPath);
  if (marker.format !== 1 || marker.runId !== runId) {
    throw new Error('Backup completion marker is invalid.');
  }
  return { runDir, marker };
}

async function verifyRun(runId, signal) {
  const { root, key } = await backupContext();
  try {
    const { runDir, marker } = await openRun(root, runId);
    const artifacts = [];
    for await (const record of readManifest(runDir, key, marker, signal)) {
      if (!['database', 'postgres-globals', 'media-object'].includes(record.type)) continue;
      if (record.type === 'postgres-globals' && record.status !== 'captured') continue;
      const encryptedPath = validateRelativePath(runDir, record.relativePath);
      const fileStat = await lstat(encryptedPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        throw new Error('Backup artifact is not a regular file.');
      }
      const verified = await verifyEncryptedFile(encryptedPath, key, record, { signal });
      if (record.type === 'database') {
        const tempArchive = path.join(os.tmpdir(), `watchtube-archive-${randomUUID()}.dump`);
        try {
          await decryptFile(encryptedPath, tempArchive, key, record, { signal });
          await runPgRestoreList(tempArchive, signal);
        } finally {
          await rm(tempArchive, { force: true });
        }
      }
      artifacts.push({ type: record.type, sizeBytes: verified.plainSizeBytes, sha256: verified.plainSha256 });
    }
    return { runId, status: 'verified', artifactCount: artifacts.length, artifacts };
  } finally {
    key.fill(0);
  }
}

async function restoreTest(runId, signal) {
  if (process.env.WATCHTUBE_RESTORE_TEST !== '1') {
    throw new Error('Set WATCHTUBE_RESTORE_TEST=1 only for an explicitly isolated local restore drill.');
  }
  const testUrl = process.env.WATCHTUBE_RESTORE_TEST_URL;
  const connection = parseDatabaseUrl(testUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(connection.host.toLowerCase())) {
    throw new Error('Restore drill is restricted to a loopback PostgreSQL host.');
  }
  const { root, key } = await backupContext();
  let tempArchive;
  let targetDatabase;
  try {
    const { runDir, marker } = await openRun(root, runId);
    let databaseRecord;
    for await (const record of readManifest(runDir, key, marker, signal)) {
      if (record.type === 'database' && !databaseRecord) databaseRecord = record;
    }
    if (!databaseRecord) throw new Error('Backup contains no PostgreSQL database archive.');
    const archivePath = validateRelativePath(runDir, databaseRecord.relativePath);
    tempArchive = path.join(os.tmpdir(), `watchtube-restore-${randomUUID()}.dump`);
    await decryptFile(archivePath, tempArchive, key, databaseRecord, { signal });
    await runPgRestoreList(tempArchive, signal);
    targetDatabase = `watchtube_restore_test_${randomUUID().replace(/-/g, '')}`;
    await runPgCommand('createdb', [
      '--no-password',
      '--template=template0',
      targetDatabase,
    ], connection, signal);
    await runPgCommand('pg_restore', [
      '--no-password',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-acl',
      `--dbname=${targetDatabase}`,
      tempArchive,
    ], connection, signal);
    const targetUrl = new URL(testUrl);
    targetUrl.pathname = `/${encodeURIComponent(targetDatabase)}`;
    const restoredInventory = await inspectDatabase(targetUrl.toString(), signal);
    if (!Array.isArray(restoredInventory.tables)) {
      throw new Error('Restored database inventory could not be verified.');
    }
    return {
      runId,
      status: 'restored-to-isolated-local-database',
      targetDatabase,
      restoredTableCount: restoredInventory.tables.length,
      restoredDatabaseSizeBytes: restoredInventory.databaseSizeBytes,
      note: 'The test database was intentionally left in place; no database was dropped.',
    };
  } finally {
    if (tempArchive) await rm(tempArchive, { force: true });
    key.fill(0);
  }
}

async function restoreMediaTest(runId, signal) {
  await verifyRun(runId, signal);
  const { root, key } = await backupContext();
  try {
    const { runDir, marker } = await openRun(root, runId);
    const result = await restoreMediaObjects({
      runDir,
      key,
      runId,
      records: readManifest(runDir, key, marker, signal),
      buckets: sourceBuckets(),
      signal,
    });
    return {
      runId,
      status: 'restored-to-isolated-object-storage',
      ...result,
      note: 'Objects were copied without overwriting; the restore prefix was left in place.',
    };
  } finally {
    key.fill(0);
  }
}

async function inventory(signal) {
  const database = await inspectDatabase(undefined, signal);
  const client = createSourceClient();
  try {
    return { database, media: await inventoryMedia(client, sourceBuckets(), signal) };
  } finally {
    client.destroy();
  }
}

async function retentionDryRun() {
  const root = await backupRoot();
  const entries = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('run-')) continue;
    const runDir = path.join(root, entry.name);
    try {
      const marker = await readJson(path.join(runDir, COMPLETE_MARKER));
      if (marker.runId === entry.name && Number.isFinite(Date.parse(marker.completedAt))) {
        entries.push({ runId: entry.name, completedAt: marker.completedAt });
      }
    } catch {
      // Incomplete or invalid runs are retained and reported separately below.
    }
  }
  entries.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  const keptDays = new Set();
  const keptWeeks = new Set();
  const keptMonths = new Set();
  const kept = new Set();
  const now = new Date();
  for (const entry of entries) {
    const date = new Date(entry.completedAt);
    const ageDays = (now.getTime() - date.getTime()) / 86400000;
    const day = date.toISOString().slice(0, 10);
    const week = `${date.getUTCFullYear()}-${Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 604800000)}`;
    const month = date.toISOString().slice(0, 7);
    if (ageDays < 7 && !keptDays.has(day)) {
      keptDays.add(day);
      kept.add(entry.runId);
    } else if (ageDays < 35 && !keptWeeks.has(week)) {
      keptWeeks.add(week);
      kept.add(entry.runId);
    } else if (ageDays < 366 && !keptMonths.has(month)) {
      keptMonths.add(month);
      kept.add(entry.runId);
    }
  }
  return {
    status: 'dry-run-only',
    keepPolicy: { dailyDays: 7, weeklyDays: 35, monthlyDays: 366 },
    keep: [...kept],
    candidates: entries.filter((entry) => !kept.has(entry.runId)).map((entry) => entry.runId),
    deleted: 0,
    note: 'No backup is deleted by this tool.',
  };
}

function safeErrorMessage(error) {
  return redactedErrorMessage(error);
}

function usage() {
  return [
    'WatchTube local backup tool (does not load .env files)',
    '  node tools/backup-system/cli.mjs keygen <absolute-key-path>',
    '  node tools/backup-system/cli.mjs inventory',
    '  node tools/backup-system/cli.mjs backup:database',
    '  node tools/backup-system/cli.mjs backup:media',
    '  node tools/backup-system/cli.mjs backup:full',
    '  node tools/backup-system/cli.mjs verify <run-id>',
    '  node tools/backup-system/cli.mjs restore-test <run-id>',
    '  node tools/backup-system/cli.mjs restore-media-test <run-id>',
    '  node tools/backup-system/cli.mjs retention:dry-run',
  ].join('\n');
}

async function main(args, signal) {
  const [command, argument] = args;
  let result;
  switch (command) {
    case 'keygen':
      if (!argument || !path.isAbsolute(argument)) throw new Error('keygen requires a new absolute file path.');
      await validateNewKeyPath(argument);
      await createKeyFile(argument);
      result = { status: 'created', path: argument, bytes: 32, note: 'Store a separate recovery copy of this key.' };
      break;
    case 'inventory':
      result = await inventory(signal);
      break;
    case 'backup:database':
      result = await createBackup({ includeDatabase: true, includeMedia: false }, signal);
      break;
    case 'backup:media':
      result = await createBackup({ includeDatabase: false, includeMedia: true }, signal);
      break;
    case 'backup:full':
      result = await createBackup({ includeDatabase: true, includeMedia: true }, signal);
      break;
    case 'verify':
      result = await verifyRun(argument, signal);
      break;
    case 'restore-test':
      result = await restoreTest(argument, signal);
      break;
    case 'restore-media-test':
      result = await restoreMediaTest(argument, signal);
      break;
    case 'retention:dry-run':
      result = await retentionDryRun();
      break;
    default:
      process.stdout.write(`${usage()}\n`);
      process.exitCode = 2;
      return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const operation = new AbortController();
process.once('SIGINT', () => operation.abort(new Error('Backup operation interrupted.')));
process.once('SIGTERM', () => operation.abort(new Error('Backup operation terminated.')));

main(process.argv.slice(2), operation.signal).catch((error) => {
  process.stderr.write(`Backup operation failed: ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
