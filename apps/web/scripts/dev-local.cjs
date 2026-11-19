const path = require('node:path');
const { spawn } = require('node:child_process');

process.env.WATCHTUBE_LOCAL_ONLY = '1';

const viteCli = path.resolve(__dirname, '../node_modules/vite/bin/vite.js');
const child = spawn(process.execPath, [viteCli, ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
