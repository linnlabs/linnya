const { parentPort, workerData } = require('node:worker_threads');
parentPort.on('message', message => {
  if (message.type === 'host-result' || message.type === 'host-failure') {
    parentPort.postMessage({ type: 'completed', result: message });
  }
});
parentPort.postMessage({ type: 'host-request', requestId: 'request-1', operation: workerData.operation, payload: { taskId: workerData.taskId } });
if (workerData.exitEarly) setTimeout(() => process.exit(0), 30);
