const { parentPort, workerData } = require('node:worker_threads');

parentPort.postMessage({
  type: 'completed',
  result: {
    runtimePathRoots: workerData.runtimePathRoots,
    distributionIdentity: workerData.distributionIdentity,
  },
});
