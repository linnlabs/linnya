import { Logger } from '@plugin/backend/loggingRuntime';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  createPluginWorkerQueue,
  type PluginWorkerQueue,
  type PluginWorkerJob,
} from '@plugin/backend/workerQueue';
import type { KnowledgeActivityOwner } from '../../runtime/orchestration/createKnowledgeActivityOwner';
import type {
  KnowledgeActivityKind,
  KnowledgeActivityLease,
} from '../../runtime/definitions/knowledgeActivity';
import type {
  IngestionJobPayload,
  GraphExtractionJobPayloadInput,
  GraphIndexingJobPayloadInput,
  KnowledgeWorkerPaths,
} from '../definitions/jobs';

export type IngestionWorkerJob = PluginWorkerJob<IngestionJobPayload>;
type ExtractionQueued = GraphExtractionJobPayloadInput & { runtime: KnowledgeWorkerPaths };
type IndexingQueued = GraphIndexingJobPayloadInput & { runtime: KnowledgeWorkerPaths };
type JobInput<T> = Omit<T, 'runtime'>;
type Progress = { taskId: string; progress: number; data: unknown };
type Completed = { taskId: string; result: unknown };
type Failed = { taskId: string; error: string };
type QueueEvents = {
  'ingestion:taskProgress': [Progress];
  'ingestion:taskCompleted': [Completed];
  'ingestion:taskFailed': [Failed];
  'graphExtraction:taskProgress': [Progress];
  'graphExtraction:taskCompleted': [Completed];
  'graphExtraction:taskFailed': [Failed];
  'graphIndexing:taskProgress': [Progress];
  'graphIndexing:taskCompleted': [Completed];
  'graphIndexing:taskFailed': [Failed];
};

/** 三类任务归属于同一个插件 activation，停用不会触及 Audio 或其他队列。 */
export class KnowledgeQueues extends EventEmitter<QueueEvents> {
  private readonly ingestion: PluginWorkerQueue<IngestionJobPayload>;
  private readonly extraction: PluginWorkerQueue<ExtractionQueued>;
  private readonly indexing: PluginWorkerQueue<IndexingQueued>;
  private readonly leases = new Map<
    string,
    { lease: KnowledgeActivityLease; removeAbort(): void }
  >();
  private readonly unsubscribe: Array<() => void> = [];
  private accepting = true;
  private readonly logger = new Logger('KnowledgeQueues');

  constructor(
    private readonly options: {
      activity: KnowledgeActivityOwner;
      paths: Omit<KnowledgeWorkerPaths, 'temporaryDirectory' | 'qdrantUrl'> & {
        temporaryDirectory: string;
      };
      resolveVectorUrl(signal?: AbortSignal): Promise<string>;
      prepareIngestion?(job: JobInput<IngestionJobPayload>): JobInput<IngestionJobPayload>;
    }
  ) {
    super();
    this.ingestion = createPluginWorkerQueue({
      pluginId: 'knowledge',
      workerEntry: 'dist/backend/workers/knowledgeIngestion.worker.cjs',
      inferenceAdmission: job => ({
        operations: ['embed', 'text', 'ocr-profile', 'ocr'],
        modelIds: [job.embeddingModelId, job.pdfOcrModelId, job.imageVisionModelId].filter(
          (id): id is string => typeof id === 'string'
        ),
        inputFiles: [job.filePath],
        temporaryDirectory: job.runtime.temporaryDirectory,
      }),
    });
    this.extraction = createPluginWorkerQueue({
      pluginId: 'knowledge',
      workerEntry: 'dist/backend/workers/graphExtraction.worker.cjs',
      maxConcurrency: 1,
      inferenceAdmission: job => ({
        operations: ['text'],
        modelIds: [job.llmModelId],
        inputFiles: [],
      }),
    });
    this.indexing = createPluginWorkerQueue({
      pluginId: 'knowledge',
      workerEntry: 'dist/backend/workers/graphIndexing.worker.cjs',
      maxConcurrency: 1,
      inferenceAdmission: job => ({
        operations: ['embed'],
        modelIds: [job.embeddingModelId],
        inputFiles: [],
      }),
    });
    this.unsubscribe.push(
      this.ingestion.subscribe({
        progress: event => this.emit('ingestion:taskProgress', { taskId: event.jobId, progress: event.progress, data: event.data }),
        completed: event => this.emit('ingestion:taskCompleted', { taskId: event.jobId, result: event.result }),
        failed: event => this.emit('ingestion:taskFailed', { taskId: event.jobId, error: event.error }),
        settled: id => this.release(id),
      }),
      this.extraction.subscribe({
        progress: event => this.emit('graphExtraction:taskProgress', { taskId: event.jobId, progress: event.progress, data: event.data }),
        completed: event => this.emit('graphExtraction:taskCompleted', { taskId: event.jobId, result: event.result }),
        failed: event => this.emit('graphExtraction:taskFailed', { taskId: event.jobId, error: event.error }),
        settled: id => this.release(id),
      }),
      this.indexing.subscribe({
        progress: event => this.emit('graphIndexing:taskProgress', { taskId: event.jobId, progress: event.progress, data: event.data }),
        completed: event => this.emit('graphIndexing:taskCompleted', { taskId: event.jobId, result: event.result }),
        failed: event => this.emit('graphIndexing:taskFailed', { taskId: event.jobId, error: event.error }),
        settled: id => this.release(id),
      })
    );
  }

  subscribeToEvent<K extends keyof QueueEvents>(
    event: K,
    listener: K extends keyof QueueEvents
      ? QueueEvents[K] extends unknown[]
        ? (...args: QueueEvents[K]) => void
        : never
      : never
  ): () => void {
    this.on(event, listener);
    return () => {
      this.off(event, listener);
    };
  }

  private release(id: string): void {
    const owned = this.leases.get(id);
    if (!owned) return;
    owned.removeAbort();
    owned.lease.release();
    this.leases.delete(id);
  }

  private async admit<T extends { taskId: string; kbId: string }>(
    input: T,
    kind: KnowledgeActivityKind,
    queue: PluginWorkerQueue<T>,
    prepare: (signal: AbortSignal) => Promise<T>
  ): Promise<string> {
    if (!this.accepting) throw new Error('知识库正在停用，不能开始新任务');
    const lease = this.options.activity.begin(input.kbId, kind);
    const abort = () => {
      void queue
        .cancelJob(input.taskId)
        .catch(error =>
          this.logger.error('取消知识库任务失败，owner 保留并由 shutdown 继续收尾', {
            taskId: input.taskId,
            error,
          })
        );
    };
    lease.signal.addEventListener('abort', abort, { once: true });
    this.leases.set(input.taskId, {
      lease,
      removeAbort: () => lease.signal.removeEventListener('abort', abort),
    });
    try {
      const prepared = await prepare(lease.signal);
      lease.signal.throwIfAborted();
      const id = await queue.addJob(input.taskId, prepared);
      if (lease.signal.aborted) await queue.cancelJob(id);
      return id;
    } catch (error) {
      this.release(input.taskId);
      throw error;
    }
  }

  private paths(id: string): KnowledgeWorkerPaths {
    return {
      ...this.options.paths,
      temporaryDirectory: path.join(this.options.paths.temporaryDirectory, id),
    };
  }

  async addIngestionTask(input: JobInput<IngestionJobPayload>): Promise<string> {
    const task = {
      ...(this.options.prepareIngestion?.(input) ?? input),
      runtime: this.paths(input.taskId),
    };
    return this.admit(task, 'ingestion', this.ingestion, async signal => ({
      ...task,
      ocrTemporaryDirectory: task.runtime.temporaryDirectory,
      runtime: { ...task.runtime, qdrantUrl: await this.options.resolveVectorUrl(signal) },
    }));
  }
  async addGraphExtractionTask(input: JobInput<GraphExtractionJobPayloadInput>): Promise<string> {
    const task = { ...input, runtime: this.paths(input.taskId) };
    return this.admit(task, 'graph', this.extraction, async () => task);
  }
  async addGraphIndexingTask(input: JobInput<GraphIndexingJobPayloadInput>): Promise<string> {
    const task = { ...input, runtime: this.paths(input.taskId) };
    return this.admit(task, 'graph', this.indexing, async signal => ({
      ...task,
      runtime: { ...task.runtime, qdrantUrl: await this.options.resolveVectorUrl(signal) },
    }));
  }
  listIngestionTasks() {
    return this.ingestion.listJobs();
  }
  listGraphExtractionTasks() {
    return this.extraction.listJobs();
  }
  listGraphIndexingTasks() {
    return this.indexing.listJobs();
  }
  getTaskById(id: string) {
    return this.ingestion.getJob(id);
  }
  cancelIngestionTask(id: string) {
    return this.ingestion.cancelJob(id);
  }
  cancelGraphExtractionTask(id: string) {
    return this.extraction.cancelJob(id);
  }
  cancelGraphIndexingTask(id: string) {
    return this.indexing.cancelJob(id);
  }
  async shutdown(): Promise<void> {
    this.accepting = false;
    // settled 仍订阅到三个队列全部关闭之后，不能因提前解绑而丢掉租约释放。
    await this.ingestion.shutdown();
    await this.extraction.shutdown();
    await this.indexing.shutdown();
    for (const dispose of this.unsubscribe) dispose();
    this.removeAllListeners();
  }
}
