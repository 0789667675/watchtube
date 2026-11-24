process.env.WATCHTUBE_LOCAL_ONLY = '1';

const path = require('node:path');

const envFile = path.resolve(__dirname, '../.env');
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

require('ts-node').register({
  project: path.resolve(__dirname, '../tsconfig.json'),
});
const { getStorageConfigurationStatus } = require('../src/services/storage.service.ts');
const status = getStorageConfigurationStatus(false);
console.log(JSON.stringify({
  status: status.status || (status.missing.length === 0 ? 'configured' : 'unconfigured'),
  missing: status.missing,
}));
