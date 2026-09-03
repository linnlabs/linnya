const { parentPort, workerData } = require('node:worker_threads');

const line = '[2026-07-31T12:00:00.000Z] [WARN] [FixtureWorker] bounded worker summary';
parentPort.postMessage({
  type: 'diagnostic_log',
  version: 1,
  record: {
    receivedAtIso: '2026-07-31T12:00:00.000Z',
    targetDate: '2026-07-31',
    level: 'WARN',
    line,
    utf8Bytes: Buffer.byteLength(line, 'utf8') + 1,
  },
});
parentPort.postMessage({ type: 'completed', result: { taskId: workerData.taskId } });
