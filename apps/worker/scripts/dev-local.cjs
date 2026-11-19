process.env.WATCHTUBE_LOCAL_ONLY = '1';
const path = require('node:path');

function loadEnvFile(filePath) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(filePath);
  }
}

const packageEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '../../../.env');
try {
  loadEnvFile(packageEnv);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
try {
  loadEnvFile(rootEnv);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

require('ts-node/register');
require('../src/worker.ts').startWorker();
