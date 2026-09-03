import fs from 'node:fs';
import path from 'node:path';

import type { QueueWorkerRuntime } from '../definitions/queueWorkerRuntime';

const WORKER_FILENAMES = Object.freeze({
  ingestionScriptPath: 'ingestion.worker.cjs',
  audioProcessingScriptPath: 'audio-processing.worker.cjs',
  graphExtractionScriptPath: 'graph-extraction.worker.cjs',
  graphIndexingScriptPath: 'graph-indexing.worker.cjs',
});

/**
 * 主 bundle 位于 `dist/main`，队列 Worker 位于同级的 `dist`。
 * 该布局同时适用于源码开发产物与 app.asar，不需要 Electron app API。
 */
export function resolveQueueWorkerRuntime(mainBundleDirectory: string): QueueWorkerRuntime {
  if (!path.isAbsolute(mainBundleDirectory)) {
    throw new Error('Queue Worker main bundle directory 必须是绝对路径');
  }

  const workerBundleDirectory = path.resolve(mainBundleDirectory, '..');
  const runtime: QueueWorkerRuntime = {
    ingestionScriptPath: path.join(workerBundleDirectory, WORKER_FILENAMES.ingestionScriptPath),
    audioProcessingScriptPath: path.join(
      workerBundleDirectory,
      WORKER_FILENAMES.audioProcessingScriptPath,
    ),
    graphExtractionScriptPath: path.join(
      workerBundleDirectory,
      WORKER_FILENAMES.graphExtractionScriptPath,
    ),
    graphIndexingScriptPath: path.join(
      workerBundleDirectory,
      WORKER_FILENAMES.graphIndexingScriptPath,
    ),
  };

  for (const workerPath of Object.values(runtime)) {
    if (!fs.existsSync(workerPath)) {
      throw new Error(`Worker bundle 不存在: ${workerPath}。请先运行 pnpm run build:worker`);
    }
  }

  return Object.freeze(runtime);
}
