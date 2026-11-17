import { parentPort } from 'node:worker_threads';
import { Logger } from '@plugin/backend/worker/loggingRuntime';

const logger = new Logger('plugin-worker');
logger.debug('started');
logger.info('progress', { bytes: new Uint8Array(1024 * 1024) });
logger.warn('bounded', { text: '中'.repeat(100_000) });
logger.error('expected failure', new Error('synthetic test error'));
parentPort?.postMessage({ type: 'result', success: true });
parentPort?.close();
