const { appendFileSync } = require('node:fs');
const { parentPort } = require('node:worker_threads');

parentPort.on('message', ({ filePath }) => {
  appendFileSync(filePath, 'started\n', 'utf8');
  setInterval(() => appendFileSync(filePath, 'tick\n', 'utf8'), 5);
});
