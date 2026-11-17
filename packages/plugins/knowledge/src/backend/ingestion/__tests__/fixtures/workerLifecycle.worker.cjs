const { parentPort, workerData } = require('worker_threads');

parentPort.postMessage({
  type: 'progress',
  frontendState: workerData.progressState,
});
parentPort.postMessage({
  type: 'completed',
  result: workerData.completionResult,
});
