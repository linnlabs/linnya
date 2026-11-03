import { parentPort } from 'node:worker_threads';
import { CanvasLayoutWorkerRequestSchema, CanvasLayoutWorkerResponseSchema } from './definitions/canvasComputationWorker';
import { executeCanvasLayout } from '../features/canvasLayoutRun/worker';

if (!parentPort) throw new Error('Canvas layout entry requires a worker thread');
const channel = parentPort;
channel.on('message', async (value: unknown) => {
  try {
    const request = CanvasLayoutWorkerRequestSchema.parse(value);
    const result = await executeCanvasLayout(request);
    channel.postMessage(CanvasLayoutWorkerResponseSchema.parse({ status: 'ready', result }));
  } catch (error) {
    channel.postMessage({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
});
