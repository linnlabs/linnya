import { Worker } from 'node:worker_threads';

export interface PresentationBuildWorkerTransport {
  postMessage(message: unknown, transferList?: readonly ArrayBuffer[]): void;
  onMessage(listener: (message: unknown) => void): void;
  onError(listener: (error: Error) => void): void;
  onExit(listener: (exitCode: number) => void): void;
  terminate(): Promise<number>;
}

export type PresentationBuildWorkerTransportFactory = (
  workerPath: string,
) => PresentationBuildWorkerTransport;

export function createPresentationBuildWorkerTransport(
  workerPath: string,
): PresentationBuildWorkerTransport {
  const worker = new Worker(workerPath, {
    name: 'slides-presentation-build',
  });
  return {
    postMessage(message, transferList) {
      worker.postMessage(message, transferList ? [...transferList] : undefined);
    },
    onMessage(listener) {
      worker.on('message', listener);
    },
    onError(listener) {
      worker.on('error', listener);
    },
    onExit(listener) {
      worker.on('exit', listener);
    },
    terminate() {
      return worker.terminate();
    },
  };
}
