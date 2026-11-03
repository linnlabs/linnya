import { parentPort } from 'node:worker_threads';
import { CanvasComputationWorkerRequestSchema, CanvasComputationWorkerResponseSchema } from './definitions/canvasComputationWorker';
import { checkCanvas } from '../features/canvasQuery';

if (!parentPort) throw new Error('Canvas layout entry requires a worker thread');
const channel = parentPort;
channel.on('message', async (value: unknown) => {
  try {
    const request = CanvasComputationWorkerRequestSchema.parse(value);
    if (request.kind === 'check') channel.postMessage(CanvasComputationWorkerResponseSchema.parse({ status: 'ready', response: { kind: 'check', result: checkCanvas(request.snapshot) } }));
    else {
      const { executeCanvasLayout } = await import('../features/canvasLayoutRun/worker');
      channel.postMessage(CanvasComputationWorkerResponseSchema.parse({ status: 'ready', response: { kind: 'layout', result: await executeCanvasLayout(request.request) } }));
    }
  } catch (error) {
    channel.postMessage({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
});
