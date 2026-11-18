import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PG_BIN = String.raw`C:\Program Files\PostgreSQL\18\bin`;
const HOST = '127.0.0.1';
const PORT = 5432;
const DEFAULT_ROLE = 'postgres';
const REQUIRED_VERSION = '18.4';
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const HEADER = Buffer.from('WTBKP001', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = HEADER.length + NONCE_BYTES + TAG_BYTES;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DPAPI_SCRIPT = path.join(SCRIPT_DIR, 'dpapi-key.ps1');
const TABLE_NAMES = ['users', 'channels', 'videos', 'video_variants'];

function parseOptions(args) {
  const options = {
    pgBin: DEFAULT_PG_BIN,
    role: DEFAULT_ROLE,
    sourceDatabase: undefined,
    restoreDatabase: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--pg-bin' && args[index + 1]) {
      options.pgBin = args[++index];
    } else if (args[index] === '--role' && args[index + 1]) {
      options.role = args[++index];
    } else if (args[index] === '--source-db' && args[index + 1]) {
      options.sourceDatabase = args[++index];
    } else if (args[index] === '--restore-db' && args[index + 1]) {
      options.restoreDatabase = args[++index];
    } else {
      throw new Error(`Unknown or incomplete option: ${args[index]}`);
    }
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(options.role)) {
    throw new Error('The local PostgreSQL role name is invalid.');
  }
  if (Boolean(options.sourceDatabase) !== Boolean(options.restoreDatabase)) {
    throw new Error('--source-db and --restore-db must be supplied together.');
  }
  for (const name of [options.sourceDatabase, options.restoreDatabase].filter(Boolean)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)) {
      throw new Error('A prototype database name is invalid.');
    }
  }
  return options;
}

function sanitizedEnvironment(passFile) {
  const safeNames = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'];
  const environment = {};
  for (const name of safeNames) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  environment.PGPASSFILE = passFile;
  return environment;
}

function runTool(executable, args, options = {}) {
  const {
    input,
    env,
    allowFailure = false,
    maxOutput = MAX_CAPTURE_BYTES,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };

    child.on('error', fail);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutput) {
        fail(new Error(`${path.basename(executable)} exceeded the capture limit.`));
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxOutput) {
        fail(new Error(`${path.basename(executable)} exceeded the diagnostic limit.`));
      } else {
        stderr.push(chunk);
      }
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') fail(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      const result = {
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code !== 0 && !allowFailure) {
        reject(new Error(
          `${path.basename(executable)} exited ${code}: ${result.stderr.trim() || 'no diagnostic output'}`,
        ));
      } else {
        resolve(result);
      }
    });

    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function identityQuery() {
  return `SELECT json_build_object(
    'database', current_database(),
    'address', inet_server_addr()::text,
    'port', inet_server_port(),
    'role', current_user,
    'serverVersion', version()
  )::text;`;
}

async function psql(pgBin, role, database, sql, env, input) {
  const executable = path.join(pgBin, 'psql.exe');
  const args = [
    '-X', '-w', '-h', HOST, '-p', String(PORT), '-U', role, '-d', database,
    '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
  ];
  if (input) args.push('-f', '-');
  else args.push('-c', sql);
  const result = await runTool(executable, args, { env, input });
  return result.stdout.toString('utf8').trim();
}

async function psqlJson(pgBin, role, database, sql, env) {
  return JSON.parse(await psql(pgBin, role, database, sql, env));
}

function assertIdentity(identity, expectedDatabase, role) {
  if (identity.database !== expectedDatabase
      || identity.address?.split('/')[0] !== HOST
      || identity.port !== PORT
      || identity.role !== role
      || !identity.serverVersion.startsWith(`PostgreSQL ${REQUIRED_VERSION} `)) {
    throw new Error(`Database identity check failed for ${expectedDatabase}; refusing further SQL.`);
  }
}

async function assertEmptyDatabase(pgBin, role, database, env) {
  const relationCount = Number(await psql(
    pgBin,
    role,
    database,
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');",
    env,
  ));
  if (relationCount !== 0) {
    throw new Error(`Fresh database ${database} is not empty; refusing to continue.`);
  }
}

async function createDatabase(pgBin, role, database, env) {
  await runTool(path.join(pgBin, 'createdb.exe'), [
    '--no-password', '--host', HOST, '--port', String(PORT), '--username', role,
    '--template', 'template0', database,
  ], { env });
}

async function collectState(pgBin, role, database, env) {
  const counts = await psqlJson(pgBin, role, database, `SELECT json_build_object(
    'users', (SELECT count(*) FROM public.users),
    'channels', (SELECT count(*) FROM public.channels),
    'videos', (SELECT count(*) FROM public.videos),
    'video_variants', (SELECT count(*) FROM public.video_variants)
  )::text;`, env);

  const constraints = await psqlJson(pgBin, role, database, `SELECT json_build_object(
    'primaryKeys', count(*) FILTER (WHERE contype = 'p'),
    'uniqueConstraints', count(*) FILTER (WHERE contype = 'u'),
    'foreignKeys', count(*) FILTER (WHERE contype = 'f')
  )::text FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public';`, env);

  const relationships = await psqlJson(pgBin, role, database, `SELECT json_build_object(
    'channelsWithOwners', (SELECT count(*) FROM public.channels c JOIN public.users u ON u.id = c.user_id),
    'videosWithChannels', (SELECT count(*) FROM public.videos v JOIN public.channels c ON c.id = v.channel_id),
    'variantsWithVideos', (SELECT count(*) FROM public.video_variants x JOIN public.videos v ON v.id = x.video_id)
  )::text;`, env);

  return { counts, constraints, relationships };
}

function assertState(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} schema, counts, or relationships differ from expectations.`);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function encryptArchive(archive, key) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(archive), cipher.final()]);
  return Buffer.concat([HEADER, nonce, cipher.getAuthTag(), ciphertext]);
}

function decryptArchive(encrypted, key) {
  if (encrypted.length <= HEADER_BYTES || !encrypted.subarray(0, HEADER.length).equals(HEADER)) {
    throw new Error('Encrypted archive header is invalid or incomplete.');
  }
  const nonceStart = HEADER.length;
  const tagStart = nonceStart + NONCE_BYTES;
  const cipherStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    encrypted.subarray(nonceStart, tagStart),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAuthTag(encrypted.subarray(tagStart, cipherStart));
  return Buffer.concat([
    decipher.update(encrypted.subarray(cipherStart)),
    decipher.final(),
  ]);
}

async function writeNew(filePath, bytes) {
  await writeFile(filePath, bytes, { flag: 'wx' });
}

async function protectKey(key, keyPath, env) {
  const result = await runTool('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', DPAPI_SCRIPT, '-Mode', 'protect', '-Path', keyPath,
  ], { env, input: Buffer.from(key.toString('base64'), 'ascii') });
  if (result.stdout.length !== 0) throw new Error('Unexpected output from DPAPI key protection.');
}

async function unprotectKey(keyPath, env) {
  const result = await runTool('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', DPAPI_SCRIPT, '-Mode', 'unprotect', '-Path', keyPath,
  ], { env });
  const key = Buffer.from(result.stdout.toString('ascii'), 'base64');
  if (key.length !== 32) {
    key.fill(0);
    throw new Error('DPAPI returned an invalid AES key.');
  }
  return key;
}

function verifyEncryptedBytes(encrypted, manifest) {
  if (encrypted.length !== manifest.encryptedSizeBytes
      || sha256(encrypted) !== manifest.encryptedSha256) {
    throw new Error('Encrypted artifact size or SHA-256 does not match the manifest.');
  }
}

async function verifyArchiveList(pgBin, archive, env, expectedNames) {
  const result = await runTool(path.join(pgBin, 'pg_restore.exe'), ['--list'], {
    env,
    input: archive,
  });
  const list = result.stdout.toString('utf8');
  for (const name of expectedNames) {
    if (!list.includes(name)) throw new Error(`Archive TOC is missing ${name}.`);
  }
  return list;
}

async function expectFailure(name, operation) {
  try {
    await operation();
  } catch {
    return { name, passed: true, rejectedAsExpected: true };
  }
  throw new Error(`Negative test did not fail: ${name}`);
}

async function createRunDirectory() {
  const parent = path.join(os.tmpdir(), 'WatchTubeBackupPrototype');
  await mkdir(parent, { recursive: true });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, '').replace('T', '_');
    const runId = `${timestamp}_${randomBytes(4).toString('hex')}`;
    const runDir = path.join(parent, runId);
    try {
      await mkdir(runDir, { recursive: false });
      return { runId, runDir };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not allocate a unique run directory.');
}

async function ensureTools(pgBin) {
  const tools = ['pg_dump.exe', 'pg_restore.exe', 'psql.exe', 'createdb.exe'];
  for (const name of tools) await access(path.join(pgBin, name));
}

async function copyAndMutate(sourcePath, targetPath, mutate) {
  await copyFile(sourcePath, targetPath, 1);
  const bytes = await readFile(targetPath);
  mutate(bytes);
  await writeFile(targetPath, bytes);
  return bytes;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await ensureTools(options.pgBin);
  const { runId, runDir } = await createRunDirectory();
  const artifactDir = path.join(runDir, 'encrypted-backups');
  const keyDir = path.join(runDir, 'key-material');
  const negativeDir = path.join(runDir, 'negative-test-copies');
  await Promise.all([
    mkdir(artifactDir, { recursive: false }),
    mkdir(keyDir, { recursive: false }),
    mkdir(negativeDir, { recursive: false }),
  ]);

  const passFile = path.join(runDir, 'no-password-file');
  const env = sanitizedEnvironment(passFile);
  const clientVersions = {};
  for (const name of ['pg_dump.exe', 'pg_restore.exe', 'psql.exe']) {
    const result = await runTool(path.join(options.pgBin, name), ['--version'], { env });
    const version = result.stdout.toString('utf8').trim();
    if (!version.endsWith(REQUIRED_VERSION)) throw new Error(`Expected ${REQUIRED_VERSION}: ${version}`);
    clientVersions[name] = version;
  }

  const suffix = runId.replaceAll(/[^a-zA-Z0-9]/g, '').slice(-12).toLowerCase();
  const sourceDatabase = options.sourceDatabase || `wt_proto_src_${suffix}`;
  const restoreDatabase = options.restoreDatabase || `wt_proto_restore_${suffix}`;
  const maintenanceIdentity = await psqlJson(
    options.pgBin, options.role, 'postgres', identityQuery(), env,
  );
  assertIdentity(maintenanceIdentity, 'postgres', options.role);

  const existing = await psql(
    options.pgBin,
    options.role,
    'postgres',
    `SELECT datname FROM pg_database WHERE datname IN (${sqlLiteral(sourceDatabase)}, ${sqlLiteral(restoreDatabase)});`,
    env,
  );
  const existingNames = existing === '' ? [] : existing.split(/\r?\n/).sort();
  if (options.sourceDatabase) {
    if (JSON.stringify(existingNames) !== JSON.stringify([sourceDatabase].sort())) {
      throw new Error('Resume requires the named source to exist and the named restore target to be absent.');
    }
  } else if (existingNames.length !== 0) {
    throw new Error('A generated database name already exists; refusing to reuse it.');
  }

  console.log(JSON.stringify({
    status: 'STARTING',
    runId,
    sourceDatabase,
    restoreDatabase,
    outputDirectory: runDir,
    localEndpoint: `${HOST}:${PORT}`,
  }));

  const sourceIdentity = await psqlJson(options.pgBin, options.role, sourceDatabase, identityQuery(), env);
  assertIdentity(sourceIdentity, sourceDatabase, options.role);
  const expectedCounts = { users: 2, channels: 2, videos: 3, video_variants: 6 };
  const expectedConstraints = { primaryKeys: 4, uniqueConstraints: 3, foreignKeys: 3 };
  const expectedRelationships = { channelsWithOwners: 2, videosWithChannels: 3, variantsWithVideos: 6 };

  let expectedState;
  if (options.sourceDatabase) {
    const publicTables = await psqlJson(options.pgBin, options.role, sourceDatabase, `SELECT COALESCE(json_agg(tablename ORDER BY tablename), '[]'::json)::text FROM pg_tables WHERE schemaname = 'public';`, env);
    assertState(publicTables, [...TABLE_NAMES].sort(), 'Resumed source table inventory');
    expectedState = await collectState(options.pgBin, options.role, sourceDatabase, env);
  } else {
    await createDatabase(options.pgBin, options.role, sourceDatabase, env);
    await assertEmptyDatabase(options.pgBin, options.role, sourceDatabase, env);
    const schemaAndSeed = await readFile(path.join(SCRIPT_DIR, 'synthetic-schema.sql'));
    await psql(options.pgBin, options.role, sourceDatabase, '', env, schemaAndSeed);
    expectedState = await collectState(options.pgBin, options.role, sourceDatabase, env);
  }

  assertState(expectedState.counts, expectedCounts, 'Synthetic record counts');
  assertState(expectedState.constraints, expectedConstraints, 'Synthetic constraints');
  assertState(expectedState.relationships, expectedRelationships, 'Synthetic relationships');

  const backupStartedAt = new Date().toISOString();
  const dumpResult = await runTool(path.join(options.pgBin, 'pg_dump.exe'), [
    '--format=custom', '--no-password', '--host', HOST, '--port', String(PORT),
    '--username', options.role, '--dbname', sourceDatabase,
  ], { env });
  const archive = dumpResult.stdout;
  if (archive.length === 0 || archive.length > MAX_CAPTURE_BYTES) {
    throw new Error('The custom-format archive is empty or exceeds the 64 MiB prototype cap.');
  }
  const backupFinishedAt = new Date().toISOString();
  const archiveHash = sha256(archive);

  const key = randomBytes(32);
  const keyPath = path.join(keyDir, 'aes256.key.dpapi');
  const artifactPath = path.join(artifactDir, `${sourceDatabase}_${runId}.pgdump.aesgcm`);
  const manifestPath = path.join(artifactDir, `${sourceDatabase}_${runId}.manifest.json`);
  const encrypted = encryptArchive(archive, key);
  try {
    await protectKey(key, keyPath, env);
  } finally {
    key.fill(0);
  }
  await writeNew(artifactPath, encrypted);

  const manifest = {
    format: 'watchtube-local-backup-prototype-v1',
    runId,
    sourceDatabase,
    createdAt: new Date().toISOString(),
    backupStartedAt,
    backupFinishedAt,
    serverVersion: sourceIdentity.serverVersion,
    clientVersions,
    recordCounts: expectedState.counts,
    constraints: expectedState.constraints,
    relationships: expectedState.relationships,
    archiveFormat: 'PostgreSQL custom (-Fc)',
    archiveSizeBytes: archive.length,
    archiveSha256: archiveHash,
    encryptedArtifact: path.basename(artifactPath),
    encryptedSizeBytes: encrypted.length,
    encryptedSha256: sha256(encrypted),
    keyProtection: 'Windows DPAPI CurrentUser; protected key stored in sibling key-material directory',
    maxArchiveSizeBytes: MAX_CAPTURE_BYTES,
  };
  await writeNew(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const savedEncrypted = await readFile(artifactPath);
  verifyEncryptedBytes(savedEncrypted, manifest);
  const restoreKey = await unprotectKey(keyPath, env);
  let decryptedArchive;
  try {
    decryptedArchive = decryptArchive(savedEncrypted, restoreKey);
  } finally {
    restoreKey.fill(0);
  }
  if (sha256(decryptedArchive) !== manifest.archiveSha256
      || decryptedArchive.length !== manifest.archiveSizeBytes) {
    throw new Error('Decrypted archive size or SHA-256 does not match the manifest.');
  }
  await verifyArchiveList(options.pgBin, decryptedArchive, env, TABLE_NAMES);

  await createDatabase(options.pgBin, options.role, restoreDatabase, env);
  const restoreIdentity = await psqlJson(options.pgBin, options.role, restoreDatabase, identityQuery(), env);
  assertIdentity(restoreIdentity, restoreDatabase, options.role);
  await assertEmptyDatabase(options.pgBin, options.role, restoreDatabase, env);
  await runTool(path.join(options.pgBin, 'pg_restore.exe'), [
    '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--no-password',
    '--host', HOST, '--port', String(PORT), '--username', options.role,
    '--dbname', restoreDatabase,
  ], { env, input: decryptedArchive });

  const restoredState = await collectState(options.pgBin, options.role, restoreDatabase, env);
  assertState(restoredState, expectedState, 'Restored database');

  const sourceOnlyEmail = 'source-after-restore@example.invalid';
  await psql(options.pgBin, options.role, sourceDatabase, `INSERT INTO public.users (id, email, display_name, created_at) VALUES ('10000000-0000-4000-8000-000000000099', ${sqlLiteral(sourceOnlyEmail)}, 'Source Only Synthetic', '2026-02-01T00:00:00Z');`, env);
  const sourceOnlyExistsInRestore = await psql(
    options.pgBin,
    options.role,
    restoreDatabase,
    `SELECT EXISTS (SELECT 1 FROM public.users WHERE email = ${sqlLiteral(sourceOnlyEmail)});`,
    env,
  );
  if (sourceOnlyExistsInRestore !== 'f') throw new Error('Restore target is not independent from source.');

  const initialDatabaseState = {
    source: await collectState(options.pgBin, options.role, sourceDatabase, env),
    restore: await collectState(options.pgBin, options.role, restoreDatabase, env),
  };
  const negativeTests = [];
  const cipherStart = HEADER_BYTES;

  const modifiedCipherPath = path.join(negativeDir, 'one-byte-ciphertext-modified.copy');
  const modifiedCipher = await copyAndMutate(artifactPath, modifiedCipherPath, (bytes) => {
    if (bytes.length <= cipherStart) throw new Error('Encrypted archive is too short for tamper testing.');
    bytes[cipherStart] ^= 0x01;
  });
  const modifiedCipherKey = await unprotectKey(keyPath, env);
  try {
    negativeTests.push(await expectFailure('one-byte ciphertext modification', async () => {
      decryptArchive(modifiedCipher, modifiedCipherKey);
    }));
  } finally {
    modifiedCipherKey.fill(0);
  }

  const wrongKeyPath = path.join(negativeDir, 'wrong-key.copy');
  await copyFile(artifactPath, wrongKeyPath, 1);
  const wrongKey = randomBytes(32);
  try {
    negativeTests.push(await expectFailure('incorrect encryption key', async () => {
      decryptArchive(await readFile(wrongKeyPath), wrongKey);
    }));
  } finally {
    wrongKey.fill(0);
  }

  const badTagPath = path.join(negativeDir, 'incorrect-tag.copy');
  const badTag = await copyAndMutate(artifactPath, badTagPath, (bytes) => {
    bytes[HEADER.length + NONCE_BYTES] ^= 0x01;
  });
  const badTagKey = await unprotectKey(keyPath, env);
  try {
    negativeTests.push(await expectFailure('incorrect authentication tag', async () => {
      decryptArchive(badTag, badTagKey);
    }));
  } finally {
    badTagKey.fill(0);
  }

  const manifestArtifactPath = path.join(negativeDir, 'incorrect-manifest-artifact.copy');
  await copyFile(artifactPath, manifestArtifactPath, 1);
  const incorrectManifest = { ...manifest, encryptedSha256: '0'.repeat(64) };
  const incorrectManifestPath = path.join(negativeDir, 'incorrect-manifest.copy.json');
  await writeNew(incorrectManifestPath, `${JSON.stringify(incorrectManifest, null, 2)}\n`);
  negativeTests.push(await expectFailure('incorrect SHA-256 manifest', async () => {
    verifyEncryptedBytes(await readFile(manifestArtifactPath), incorrectManifest);
  }));

  const invalidPlaintext = Buffer.from('not a PostgreSQL custom-format archive', 'ascii');
  const invalidKeyForEncrypt = await unprotectKey(keyPath, env);
  let invalidEncrypted;
  try {
    invalidEncrypted = encryptArchive(invalidPlaintext, invalidKeyForEncrypt);
  } finally {
    invalidKeyForEncrypt.fill(0);
  }
  const invalidArchivePath = path.join(negativeDir, 'invalid-archive.copy.aesgcm');
  await writeNew(invalidArchivePath, invalidEncrypted);
  const invalidArchiveManifest = {
    encryptedSizeBytes: invalidEncrypted.length,
    encryptedSha256: sha256(invalidEncrypted),
    archiveSizeBytes: invalidPlaintext.length,
    archiveSha256: sha256(invalidPlaintext),
  };
  verifyEncryptedBytes(await readFile(invalidArchivePath), invalidArchiveManifest);
  const invalidKeyForDecrypt = await unprotectKey(keyPath, env);
  let invalidDecrypted;
  try {
    invalidDecrypted = decryptArchive(await readFile(invalidArchivePath), invalidKeyForDecrypt);
  } finally {
    invalidKeyForDecrypt.fill(0);
  }
  negativeTests.push(await expectFailure('invalid or incomplete PostgreSQL archive', async () => {
    const result = await runTool(path.join(options.pgBin, 'pg_restore.exe'), ['--list'], {
      env,
      input: invalidDecrypted,
      allowFailure: true,
    });
    if (result.code !== 0) throw new Error('pg_restore rejected the invalid archive as expected.');
  }));

  const finalDatabaseState = {
    source: await collectState(options.pgBin, options.role, sourceDatabase, env),
    restore: await collectState(options.pgBin, options.role, restoreDatabase, env),
  };
  assertState(finalDatabaseState, initialDatabaseState, 'Negative-test database isolation');

  const finalEncrypted = await readFile(artifactPath);
  verifyEncryptedBytes(finalEncrypted, manifest);
  const secondKey = await unprotectKey(keyPath, env);
  try {
    const secondPlaintext = decryptArchive(finalEncrypted, secondKey);
    if (sha256(secondPlaintext) !== manifest.archiveSha256) {
      throw new Error('Second encrypted artifact integrity check failed.');
    }
  } finally {
    secondKey.fill(0);
  }

  const report = {
    status: 'PASS',
    runId,
    sourceDatabase,
    restoreDatabase,
    outputDirectory: runDir,
    createdDatabases: [sourceDatabase, restoreDatabase],
    initialExpectedState: expectedState,
    restoredState,
    sourceAfterIndependenceCheck: finalDatabaseState.source,
    restoreAfterIndependenceCheck: finalDatabaseState.restore,
    sourceOnlyRecordAbsentFromRestore: true,
    negativeTests,
    negativeTestsLeftBothDatabasesUnchanged: true,
    finalEncryptedSha256Verified: true,
    finalDecryptionAndPlaintextHashVerified: true,
    noPlaintextArchiveWrittenToDisk: true,
    completedAt: new Date().toISOString(),
  };
  await writeNew(path.join(runDir, 'validation-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({
    status: report.status,
    runId,
    serverVersion: sourceIdentity.serverVersion,
    clientVersions,
    sourceDatabase,
    restoreDatabase,
    outputDirectory: runDir,
    archiveSizeBytes: manifest.archiveSizeBytes,
    archiveSha256: manifest.archiveSha256,
    encryptedSizeBytes: manifest.encryptedSizeBytes,
    encryptedSha256: manifest.encryptedSha256,
    recordCounts: expectedState.counts,
    constraints: expectedState.constraints,
    negativeTests: negativeTests.map((test) => test.name),
    independentRestore: true,
    databaseCleanup: 'none; both prototype databases were intentionally left intact',
  }, null, 2));
}

main().catch((error) => {
  console.error(`Prototype failed safely: ${error.message}`);
  process.exitCode = 1;
});