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
if (process.env.WATCHTUBE_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.WATCHTUBE_DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.WATCHTUBE_DIRECT_URL;
}

require('../dist/index.js');
