/* global __dirname, require, setInterval, setTimeout */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const [mode, scenarioRoot, token] = process.argv.slice(2);
const backgroundIdentityPath = path.join(scenarioRoot, 'background-identity.json');
const heartbeatPath = path.join(scenarioRoot, 'heartbeat.log');

if (mode === 'quick') {
  process.exit(0);
}

const background = spawn(
  process.execPath,
  [path.join(__dirname, 'heartbeat-child.cjs'), backgroundIdentityPath, heartbeatPath, token],
  // 后台进程脱离 ConPTY 生命周期后仍必须保留 Windows Job 归属。
  { detached: true, windowsHide: true, stdio: 'ignore' },
);
background.unref();
fs.writeFileSync(
  path.join(scenarioRoot, 'pty-root.json'),
  JSON.stringify({ version: 1, token, processId: process.pid, backgroundProcessId: background.pid }),
);

if (mode === 'natural') {
  setTimeout(() => process.exit(23), 120);
} else if (mode === 'hold') {
  setInterval(() => undefined, 1000);
} else {
  throw new Error(`unsupported PTY child mode: ${mode}`);
}
