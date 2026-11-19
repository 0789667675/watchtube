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

require('../dist/index.js');
