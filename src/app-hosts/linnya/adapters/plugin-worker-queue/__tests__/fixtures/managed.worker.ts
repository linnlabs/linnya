import { createRequire } from 'node:module';
import { runNativeProcessingFixture } from './nativeProcessing';
import { parentPort, workerData } from 'node:worker_threads';
import { openPluginWorkerDatabase } from '@plugin/backend/worker/databaseRuntime';
import { createPluginWorkerInferencePort } from '@plugin/backend/worker/inferenceRuntime';

async function run(): Promise<void> {
  const job: unknown = workerData;
  if (
    typeof job !== 'object' ||
    job === null ||
    !('taskId' in job) ||
    typeof job.taskId !== 'string' ||
    !('mode' in job) ||
    !('modelId' in job) ||
    typeof job.modelId !== 'string'
  )
    throw new Error('Invalid fixture job');
  const inference = createPluginWorkerInferencePort();
  try {
    if (job.mode === 'boundaries') {
      if (!('outsideParent' in job) || typeof job.outsideParent !== 'string') throw new Error('Missing outside parent');
      const ownRequire = createRequire(__filename);
      const outsideRequire = createRequire(job.outsideParent);
      const denied: string[] = [];
      for (const [name, require] of [['@node-rs/jieba/package.json', ownRequire], ['sharp', outsideRequire]] as const) {
        try { require(name); }
        catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') denied.push(name);
          else throw error;
        }
      }
      parentPort?.postMessage({ type: 'completed', result: denied });
      return;
    }
    if (job.mode === 'native') {
      const result = await runNativeProcessingFixture(job, inference);
      parentPort?.postMessage({ type: 'completed', result });
      return;
    }
    if (job.mode === 'crash') {
      // Host 确认收到请求后，fixture 才退出，验证意外退出也等待该请求清理。
      void inference.documentOcr.recognizeDocument({
        modelId: job.modelId,
        input: { kind: 'image_base64', base64: 'fixture', mimeType: 'image/png', pageNumber: 1 },
        options: { onProgress: () => process.exit(9) },
      });
      return;
    }
    if (job.mode === 'inference') {
      const result = await inference.embedding.embed({ modelId: job.modelId, values: ['source'] });
      parentPort?.postMessage({ type: 'completed', result });
    } else {
      const db = openPluginWorkerDatabase();
      try {
        db.prepare('INSERT INTO plugin_rows(id) VALUES (?)').run(job.taskId);
        try {
          db.transaction(() => {
            db.prepare('INSERT INTO plugin_rows(id) VALUES (?)').run('rolled-back');
            throw new Error('rollback fixture');
          })();
        } catch {
          /* 业务回滚后第一笔提交仍应可读。 */
        }
        parentPort?.postMessage({
          type: 'progress',
          frontendState: { progress: 50, phase: 'stored' },
        });
        parentPort?.postMessage({
          type: 'completed',
          result: {
            rows: db.prepare('SELECT id FROM plugin_rows ORDER BY id').all(),
            foreignKeys: db.prepare('PRAGMA foreign_keys').get(),
            busyTimeout: db.prepare('PRAGMA busy_timeout').get(),
            journal: db.prepare('PRAGMA journal_mode').get(),
            hasCredential: Boolean(process.env.OPENAI_API_KEY || process.env.NODE_OPTIONS),
            pathAvailable: Boolean(process.env.PATH || process.env.Path),
            exposed: Object.keys(db).sort(),
          },
        });
      } finally {
        db.close();
      }
    }
  } finally {
    if (job.mode !== 'crash') inference.dispose();
  }
}

void run().catch(error =>
  parentPort?.postMessage({
    type: 'failed',
    error: error instanceof Error ? error.message : String(error),
  })
);
