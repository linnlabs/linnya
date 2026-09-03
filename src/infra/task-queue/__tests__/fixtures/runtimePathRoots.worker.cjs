const { parentPort, workerData } = require('node:worker_threads');

parentPort.postMessage({
  type: 'completed',
  result: workerData.runtimePathRoots,
});
