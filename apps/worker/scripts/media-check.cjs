const path = require('node:path');
require('ts-node').register({
  project: path.resolve(__dirname, '../tsconfig.json'),
});
const { getMediaToolStatus } = require('../src/services/transcode.service.ts');
const status = getMediaToolStatus();
console.log(JSON.stringify(status));
