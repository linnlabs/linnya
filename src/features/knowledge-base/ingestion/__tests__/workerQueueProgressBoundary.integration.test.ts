import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WorkerThreadQueue,
  type WorkerJobLifecycleObserver,
} from '../../../../infra/task-queue/WorkerThreadQueue';
import {
  syncCompletionToIngestionStore,
  syncProgressToIngestionStore,
} from '../orchestration/workerIngestionProgressProjection';
import {
  getIngestionProgress,
  ingestionProgressStore,
} from '../store/ingestionProgressStore';

interface WorkerLifecycleFixturePayload {
  readonly taskId: string;
  readonly filename: string;
  readonly progressState: unknown;
  readonly completionResult: unknown;
}

const ingestionDocId = 'worker-boundary-ingestion-doc';
const unrelatedDocId = 'worker-boundary-unrelated-doc';
const workerScript = fileURLToPath(new URL('./fixtures/workerLifecycle.worker.cjs', import.meta.url));

function waitForCompletion(queue: WorkerThreadQueue<WorkerLifecycleFixturePayload>): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.once('taskCompleted', () => resolve());
    queue.once('taskFailed', (job: { readonly error?: string }) => {
      reject(new Error(job.error ?? 'Worker job failed'));
    });
  });
}

function createIngestionObserver(): WorkerJobLifecycleObserver<WorkerLifecycleFixturePayload> {
  return {
    onProgress: ({ job, data }) => {
      syncProgressToIngestionStore(data, { filename: job.data.filename });
    },
    onCompleted: ({ job, result }) => {
      syncCompletionToIngestionStore(result, { filename: job.data.filename });
    },
  };
}

describe('Worker queue 与知识库摄取进度边界', () => {
  afterEach(() => {
    ingestionProgressStore.deleteState(ingestionDocId);
    ingestionProgressStore.deleteState(unrelatedDocId);
  });

  it('只有显式注入摄取 observer 的队列才投影进度，通用队列不按 payload 字段猜测业务', async () => {
    const ingestionQueue = new WorkerThreadQueue<WorkerLifecycleFixturePayload>({
      maxConcurrency: 1,
      workerScript,
      lifecycleObserver: createIngestionObserver(),
    });
    const unrelatedQueue = new WorkerThreadQueue<WorkerLifecycleFixturePayload>({
      maxConcurrency: 1,
      workerScript,
    });

    try {
      const ingestionCompleted = waitForCompletion(ingestionQueue);
      await ingestionQueue.addTask({
        taskId: 'ingestion-worker-job',
        filename: 'report.pdf',
        progressState: {
          doc_id: ingestionDocId,
          status: 'processing',
          message: '正在解析',
          progress: 40,
          stage: 'parsing',
        },
        completionResult: { docId: ingestionDocId },
      });
      await ingestionCompleted;

      expect(getIngestionProgress(ingestionDocId)).toMatchObject({
        filename: 'report.pdf',
        status: 'completed',
        progress: 100,
      });

      const unrelatedCompleted = waitForCompletion(unrelatedQueue);
      await unrelatedQueue.addTask({
        taskId: 'unrelated-worker-job',
        filename: 'graph-input.json',
        progressState: {
          doc_id: unrelatedDocId,
          status: 'processing',
          message: '这不是摄取任务',
          progress: 60,
        },
        completionResult: { docId: unrelatedDocId },
      });
      await unrelatedCompleted;

      expect(getIngestionProgress(unrelatedDocId)).toBeNull();
    } finally {
      await Promise.all([ingestionQueue.shutdown(), unrelatedQueue.shutdown()]);
    }
  });
});
