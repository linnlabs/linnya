/* global require, setInterval */

const fs = require('node:fs');
const process = require('node:process');

const [identityPath, heartbeatPath, token] = process.argv.slice(2);

fs.writeFileSync(
  `${identityPath}.pending`,
  JSON.stringify({ version: 1, token, processId: process.pid }),
);
fs.renameSync(`${identityPath}.pending`, identityPath);
fs.appendFileSync(heartbeatPath, `ready:${token}:${process.pid}\n`);
setInterval(() => fs.appendFileSync(heartbeatPath, `beat:${Date.now()}\n`), 40);
