const { spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const packageEnv = path.join(packageRoot, '.env');
const SAFE_LOCAL_DATABASE_URL = 'postgresql://127.0.0.1:5432/watchtube?schema=public';

function isLoopbackDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return false;

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '::1') return true;
  return net.isIPv4(hostname) && Number(hostname.split('.')[0]) === 127;
}

function assertLocalDatabaseUrls(env) {
  for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    if (!isLoopbackDatabaseUrl(env[name])) {
      throw new Error(`Local Prisma commands require ${name} to use a loopback PostgreSQL host.`);
    }
  }
}

function loadPackageEnv() {
  if (typeof process.loadEnvFile !== 'function') return;

  try {
    process.loadEnvFile(packageEnv);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function createPrismaEnvironment(env, args) {
  const childEnv = { ...env };
  if (args[0] === 'generate') {
    childEnv.WATCHTUBE_DATABASE_URL = SAFE_LOCAL_DATABASE_URL;
    childEnv.WATCHTUBE_DIRECT_URL = SAFE_LOCAL_DATABASE_URL;
  } else {
    assertLocalDatabaseUrls(env);
    childEnv.WATCHTUBE_DATABASE_URL = env.DATABASE_URL;
    childEnv.WATCHTUBE_DIRECT_URL = env.DATABASE_URL_UNPOOLED;
  }

  childEnv.DATABASE_URL = SAFE_LOCAL_DATABASE_URL;
  childEnv.DATABASE_URL_UNPOOLED = SAFE_LOCAL_DATABASE_URL;
  return childEnv;
}

function runPrisma(args, env) {
  const cliPath = require.resolve('prisma');
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status === null) {
    throw new Error('The Prisma process did not exit normally.');
  }
  process.exitCode = result.status;
}

function main(args) {
  loadPackageEnv();

  if (args.length === 1 && args[0] === '--check-local') {
    assertLocalDatabaseUrls(process.env);
    return;
  }
  if (args.length === 0) {
    throw new Error('Specify a Prisma command to run after the local database check.');
  }

  runPrisma(args, createPrismaEnvironment(process.env, args));
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[database] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertLocalDatabaseUrls,
  createPrismaEnvironment,
  isLoopbackDatabaseUrl,
};
