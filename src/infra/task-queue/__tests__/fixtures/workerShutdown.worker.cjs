const { appendFileSync } = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');

appendFileSync(workerData.markerPath, `${workerData.taskId}\n`, 'utf8');
const holdOpen = setInterval(() => {}, 1000);
parentPort.on('message', message => {
  if (message?.cmd === 'cancel') {
    clearInterval(holdOpen);
    process.exit(0);
  }
});
