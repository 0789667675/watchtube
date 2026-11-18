import { spawn } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { encryptReadable } from './core.mjs';

const INVENTORY_SQL = `
BEGIN READ ONLY;
SELECT json_build_object(
  'database', current_database(),
  'serverVersion', current_setting('server_version'),
  'databaseSizeBytes', pg_database_size(current_database()),
  'schemaSizes', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', schema_sizes.nspname,
      'sizeBytes', coalesce(schema_sizes.size_bytes, 0)
    ) ORDER BY schema_sizes.nspname), '[]'::json)
    FROM (
      SELECT n.nspname, sum(pg_total_relation_size(c.oid)) AS size_bytes
      FROM pg_namespace n
      LEFT JOIN pg_class c ON c.relnamespace = n.oid
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      GROUP BY n.nspname
    ) schema_sizes
  ),
  'tables', (
    SELECT coalesce(json_agg(json_build_object(
      'schema', schemaname,
      'table', tablename,
      'estimatedRows', greatest(reltuples, 0)::bigint,
      'totalSizeBytes', pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))
    ) ORDER BY pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename)) DESC), '[]'::json)
    FROM (
      SELECT s.schemaname, s.tablename, c.reltuples
      FROM pg_tables s
      JOIN pg_class c ON c.relname = s.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = s.schemaname
      WHERE s.schemaname NOT LIKE 'pg_%' AND s.schemaname <> 'information_schema'
      ORDER BY pg_total_relation_size(quote_ident(s.schemaname) || '.' || quote_ident(s.tablename)) DESC
      LIMIT 100
    ) t
  ),
  'extensions', (
    SELECT coalesce(json_agg(extname ORDER BY extname), '[]'::json)
    FROM pg_extension
  ),
  'migrationTableExists', to_regclass('public._prisma_migrations') IS NOT NULL,
  'roleCount', (SELECT count(*) FROM pg_roles)
)::text;
ROLLBACK;
`;

const SAFE_ENV_KEYS = [
  'PATH',
  'Path',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'LANG',
];

function safeBaseEnv() {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

export function parseDatabaseUrl(value) {
  if (!value) throw new Error('DATABASE_URL is required for this operation.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is invalid.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DATABASE_URL has an invalid port.');
  }
  const query = url.searchParams;
  const pgEnv = safeBaseEnv();
  pgEnv.PGHOST = decodeURIComponent(url.hostname.replace(/^\[|\]$/g, ''));
  pgEnv.PGPORT = String(port);
  pgEnv.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  pgEnv.PGUSER = decodeURIComponent(url.username);
  pgEnv.PGPASSWORD = decodeURIComponent(url.password);
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(pgEnv.PGHOST.toLowerCase());
  const sslMode = query.get('sslmode') || (localHost ? 'prefer' : 'verify-full');
  if (!localHost && sslMode !== 'verify-full') {
    throw new Error('Remote PostgreSQL backups require sslmode=verify-full.');
  }
  pgEnv.PGSSLMODE = sslMode;
  const sslRootCert = query.get('sslrootcert');
  if (sslRootCert) pgEnv.PGSSLROOTCERT = sslRootCert;
  pgEnv.PGCONNECT_TIMEOUT = query.get('connect_timeout') || '10';
  pgEnv.PGPASSFILE = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return {
    env: pgEnv,
    host: pgEnv.PGHOST,
    port,
    database: pgEnv.PGDATABASE,
    user: pgEnv.PGUSER,
  };
}

async function pgTool(name) {
  const configuredDir = process.env.PG_BIN;
  const candidates = [
    configuredDir ? path.join(configuredDir, `${name}.exe`) : null,
    `C:\\Program Files\\PostgreSQL\\18\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`,
    `C:\\Program Files\\PostgreSQL\\16\\bin\\${name}.exe`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard installation location.
    }
  }
  return `${name}${process.platform === 'win32' ? '.exe' : ''}`;
}

function runCapture(executable, args, env, maxOutputBytes = 16 * 1024 * 1024, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    const chunks = [];
    const errorChunks = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let exceeded = false;
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        exceeded = true;
        child.kill();
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (errorBytes >= 4096) return;
      const bounded = chunk.subarray(0, 4096 - errorBytes);
      errorChunks.push(bounded);
      errorBytes += bounded.length;
    });
    child.once('error', () => reject(new Error(
      signal?.aborted
        ? 'PostgreSQL operation was interrupted.'
        : `${path.basename(executable)} could not be started.`,
    )));
    child.once('close', (code) => {
      const detail = Buffer.concat(errorChunks).toString('utf8').trim().split(/\r?\n/)[0]?.slice(0, 500);
      if (exceeded) {
        reject(new Error(`${path.basename(executable)} output exceeded the safety limit.`));
      } else if (code !== 0) {
        reject(new Error(`${path.basename(executable)} exited with code ${code}${detail ? `: ${detail}` : '.'}`));
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
  });
}

export async function inspectDatabase(databaseUrl = process.env.DATABASE_URL, signal) {
  const connection = parseDatabaseUrl(databaseUrl);
  const executable = await pgTool('psql');
  const output = await runCapture(executable, [
    '-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', INVENTORY_SQL,
  ], connection.env, 16 * 1024 * 1024, signal);
  const jsonLine = output.split(/\r?\n/).find((line) => line.trim().startsWith('{'));
  if (!jsonLine) throw new Error('PostgreSQL inventory returned no result.');
  let inventory;
  try {
    inventory = JSON.parse(jsonLine);
  } catch {
    throw new Error('PostgreSQL inventory returned invalid JSON.');
  }
  return inventory;
}

export async function getPostgresClientVersions() {
  const versions = {};
  for (const tool of ['psql', 'pg_dump', 'pg_restore']) {
    const executable = await pgTool(tool);
    versions[tool] = (await runCapture(executable, ['--version'], safeBaseEnv())).trim();
  }
  return versions;
}

export async function dumpDatabase(databaseUrl, outputPath, key, kind = 'database', signal) {
  const connection = parseDatabaseUrl(databaseUrl);
  const executable = await pgTool(kind === 'globals' ? 'pg_dumpall' : 'pg_dump');
  const args = kind === 'globals'
    ? ['--no-password', '--globals-only', '--no-role-passwords']
    : ['--no-password', '--format=custom'];
  const child = spawn(executable, args, {
    env: connection.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    signal,
  });
  let processError;
  const errorChunks = [];
  let errorBytes = 0;
  child.stderr.on('data', (chunk) => {
    if (errorBytes >= 4096) return;
    const bounded = chunk.subarray(0, 4096 - errorBytes);
    errorChunks.push(bounded);
    errorBytes += bounded.length;
  });
  child.once('error', () => {
    processError = new Error(
      signal?.aborted
        ? 'PostgreSQL operation was interrupted.'
        : `${path.basename(executable)} could not be started.`,
    );
  });
  const source = new PassThrough();
  child.stdout.pipe(source);
  let finalizedByOperation = false;
  const encrypted = encryptReadable(source, outputPath, key, { signal }).then((result) => {
    finalizedByOperation = true;
    return result;
  });
  encrypted.catch(() => {
    if (!child.killed) child.kill();
  });
  const exitCode = await new Promise((resolve) => child.once('close', resolve));
  if (exitCode !== 0) {
    source.destroy();
    try {
      await encrypted;
    } catch {
      // The failed command's partial output is deliberately discarded.
    }
    if (finalizedByOperation) await rm(outputPath, { force: true });
    const detail = Buffer.concat(errorChunks).toString('utf8').trim().split(/\r?\n/)[0]?.slice(0, 500);
    throw processError || new Error(
      `${path.basename(executable)} exited with code ${exitCode}${detail ? `: ${detail}` : '.'}`,
    );
  }
  try {
    if (processError) throw processError;
    return await encrypted;
  } catch (error) {
    if (finalizedByOperation) await rm(outputPath, { force: true });
    throw error;
  }
}

export async function runPgRestoreList(archivePath, signal) {
  const executable = await pgTool('pg_restore');
  return runCapture(executable, ['--list', archivePath], safeBaseEnv(), 16 * 1024 * 1024, signal);
}

export async function runPgCommand(name, args, connection, signal) {
  const executable = await pgTool(name);
  return runCapture(executable, args, connection.env, 16 * 1024 * 1024, signal);
}
