process.env.WATCHTUBE_LOCAL_ONLY = '1';

const path = require('node:path');

function loadApiEnv() {
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('This migration runner requires a Node.js version with process.loadEnvFile.');
  }
  try {
    process.loadEnvFile(path.resolve(__dirname, '../.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function assertLocalWatchTubeDatabase(value, name) {
  let databaseUrl;
  try {
    databaseUrl = new URL(value || '');
  } catch {
    throw new Error(`${name} must identify the local WatchTube database.`);
  }
  const hostname = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''));
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
    || !['localhost', '127.0.0.1', '::1'].includes(hostname)
    || database !== 'watchtube'
  ) {
    throw new Error('WTPP PII migration is restricted to the loopback WatchTube database.');
  }
  return databaseUrl;
}

function loadDatabaseOwnerEnv() {
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('This migration runner requires a Node.js version with process.loadEnvFile.');
  }

  for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    if (process.env[name]) assertLocalWatchTubeDatabase(process.env[name], name);
    delete process.env[name];
  }

  const ownerEnv = path.resolve(__dirname, '../../../packages/database/.env');
  try {
    process.loadEnvFile(ownerEnv);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('The local database-owner environment file is required for this migration.');
    }
    throw error;
  }
}

async function main() {
  loadApiEnv();
  loadDatabaseOwnerEnv();
  const databaseUrl = assertLocalWatchTubeDatabase(process.env.DATABASE_URL, 'DATABASE_URL');
  const directUrl = assertLocalWatchTubeDatabase(
    process.env.DATABASE_URL_UNPOOLED,
    'DATABASE_URL_UNPOOLED',
  );
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const validArgs = args.every((arg) => [
    '--apply',
    '--confirm-local-watchtube',
    '--confirm-backup-verified',
  ].includes(arg));
  if (!validArgs) throw new Error('Unsupported option.');
  if (
    apply
    && (!args.includes('--confirm-local-watchtube') || !args.includes('--confirm-backup-verified'))
  ) {
    throw new Error('Applying requires --confirm-local-watchtube and --confirm-backup-verified.');
  }

  process.env.WATCHTUBE_DATABASE_URL = databaseUrl.href;
  process.env.WATCHTUBE_DIRECT_URL = directUrl.href;
  require('ts-node/register');
  const { db } = require('@watchtube/database');
  const { migrateWtppPiiRecords } = require('../src/security/wtppPii.ts');

  try {
    const result = await migrateWtppPiiRecords({
      async listSensitiveFields() {
        return db.wtppApplication.findMany({
          select: { id: true, taxId: true, nationalIdOrPassport: true },
        });
      },
      async updateSensitiveFields(updates) {
        await db.$transaction(updates.map(({ id, taxId, nationalIdOrPassport }) => (
          db.wtppApplication.update({
            where: { id },
            data: { taxId, nationalIdOrPassport },
            select: { id: true },
          })
        )));
      },
    }, apply);
    console.log(`WTPP PII migration ${apply ? 'applied' : 'dry-run'}: scanned=${result.scanned}, encrypted=${result.encrypted}.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error('[WTPP PII migration] Failed.', {
    name: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
