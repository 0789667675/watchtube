process.env.WATCHTUBE_LOCAL_ONLY = '1';
const path = require('node:path');

function loadEnvFile(filePath) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(filePath);
  }
}

const packageEnv = path.resolve(__dirname, '../.env');
try {
  loadEnvFile(packageEnv);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!process.env.WATCHTUBE_DATABASE_URL?.trim()) {
  throw new Error('Local API development requires WATCHTUBE_DATABASE_URL for the least-privilege API role.');
}
process.env.DATABASE_URL = process.env.WATCHTUBE_DATABASE_URL;
delete process.env.DATABASE_URL_UNPOOLED;
delete process.env.WATCHTUBE_DIRECT_URL;
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';

require('ts-node').register({
  project: path.resolve(__dirname, '../tsconfig.json'),
});
require('../src/index.ts');
