/**
 * src/pipeline/queues.ts
 * 
 * 任务队列管理器 - 基于 Worker Threads 的轻量级实现
 * 适合 Electron 桌面应用，无需外部依赖
 */

import { EventEmitter } from 'events';
import type {
  IngestionJobPayload,
  GraphExtractionJobPayloadInput,
  GraphIndexingJobPayloadInput,
} from './jobs';
import { InternalStage } from '../../features/knowledge-base/ingestion/definitions/state';
import { STAGE_MESSAGES } from '../../features/knowledge-base/ingestion/definitions/stateMapping';
import type { QueueJobPresentationPublisher } from './definitions/queueJobPresentationPublisher';
import {
  WorkerThreadQueue,
  type WorkerJob,
  type WorkerJobLifecycleObserver,
} from './WorkerThreadQueue';
import { AudioProcessingQueue } from './AudioProcessingQueue';
import type { AudioPreprocessingConfig } from '../../features/transcription/audio-preprocessing/config';
import type { QueueWorkerRuntime } from './definitions/queueWorkerRuntime';
import type { RuntimePathRoots } from '../../shared/runtime-paths';
import type { DistributionIdentity } from '../../shared/distribution-identity';

/**
 * src/pipeline/queues.ts
 * 
 * 任务队列管理器 - 基于 Worker Threads 的轻量级实现
 * 适合 Electron 桌面应用，无需外部依赖
 */

/**
 * 摄取 Worker job 的具体负载类型。
 */
export type IngestionWorkerJob = WorkerJob<IngestionJobPayload>;

/**
 * 单例队列管理器
 */
export type QueueManagerEvents = {
  'ingestion:taskProgress': (payload: { taskId: string; progress: number; data: unknown }) => void;
  'ingestion:taskCompleted': (payload: { taskId: string; result: unknown }) => void;
  'ingestion:taskFailed': (payload: { taskId: string; error?: string }) => void;

  'graphExtraction:taskProgress': (payload: { taskId: string; progress: number; data: unknown }) => void;
  'graphExtraction:taskCompleted': (payload: { taskId: string; result: unknown }) => void;
  'graphExtraction:taskFailed': (payload: { taskId: string; error?: string }) => void;

  'graphIndexing:taskProgress': (payload: { taskId: string; progress: number; data: unknown }) => void;
  'graphIndexing:taskCompleted': (payload: { taskId: string; result: unknown }) => void;
  'graphIndexing:taskFailed': (payload: { taskId: string; error?: string }) => void;
};

export class QueueManager extends EventEmitter {
  private static instance: QueueManager | null = null;
  private ingestionQueue: WorkerThreadQueue<IngestionJobPayload> | null = null;
  private graphExtractionQueue: WorkerThreadQueue<GraphExtractionJobPayloadInput> | null = null;
  private graphIndexingQueue: WorkerThreadQueue<GraphIndexingJobPayloadInput> | null = null;
  private readonly audioProcessingQueue = new AudioProcessingQueue();
  private qdrantUrl: string | null = null;
  protected constructor() {
    super();
  }

  /**
   * 功能 (What): 获取队列管理器单例实例
   * 输入 (Input): 无
   * 输出 (Output): QueueManager实例
   * 副作用 (Side-effects): 创建单例实例（如果不存在）
   */
  static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  /**
   * 功能 (What): 初始化队列管理器
   * 输入 (Input): 配置选项
   * 输出 (Output): 无
   * 副作用 (Side-effects): 创建摄入任务队列和音频处理队列
   */
  async initialize(options: {
    workerRuntime: QueueWorkerRuntime;
    runtimePathRoots: RuntimePathRoots;
    distributionIdentity: DistributionIdentity;
    maxConcurrency?: number;
    qdrantUrl?: string;
    ingestionLifecycleObserver?: WorkerJobLifecycleObserver<IngestionJobPayload>;
    jobPresentationPublisher?: QueueJobPresentationPublisher;
  }): Promise<void> {
    console.log('[QueueManager] 正在初始化任务队列系统...');
    this.qdrantUrl = options.qdrantUrl || null;

    // 初始化文档摄入队列
    this.ingestionQueue = new WorkerThreadQueue<IngestionJobPayload>({
      maxConcurrency: options.maxConcurrency,
      workerScript: options.workerRuntime.ingestionScriptPath,
      lifecycleObserver: options.ingestionLifecycleObserver,
      runtimePathRoots: options.runtimePathRoots,
      distributionIdentity: options.distributionIdentity,
    });

    // 监听队列事件并发布任务事实，同时对外提供通用事件订阅（扩展点）。
    this.ingestionQueue.on('taskProgress', (eventData: { taskId: string; progress: number; data: unknown }) => {
      options.jobPresentationPublisher?.publishProgress({
        jobId: eventData.taskId,
        progress: eventData.progress,
        data: eventData.data,
      });
      this.emit('ingestion:taskProgress', eventData);
    });

    this.ingestionQueue.on('taskCompleted', (eventData: { taskId: string; result: unknown }) => {
      options.jobPresentationPublisher?.publishCompletion({
        jobId: eventData.taskId,
        result: eventData.result,
      });
      this.emit('ingestion:taskCompleted', eventData);
    });

    this.ingestionQueue.on('taskFailed', (task: IngestionWorkerJob) => {
      options.jobPresentationPublisher?.publishFailure({
        jobId: task.id,
        jobData: task.data,
        errorMessage: task.error,
        failedMessage: STAGE_MESSAGES[InternalStage.FAILED],
      });
      this.emit('ingestion:taskFailed', { taskId: task.id, error: task.error });
    });

    // 初始化音频处理队列
    await this.audioProcessingQueue.initialize(options.workerRuntime.audioProcessingScriptPath);

    // 初始化“可选队列”：图谱抽取（低优先级，默认单并发）
    // 说明：QueueManager 只负责队列的生命周期，不承载知识库图谱的业务编排逻辑。
    try {
      this.graphExtractionQueue = new WorkerThreadQueue<GraphExtractionJobPayloadInput>({
        maxConcurrency: 1,
        workerScript: options.workerRuntime.graphExtractionScriptPath,
        runtimePathRoots: options.runtimePathRoots,
        distributionIdentity: options.distributionIdentity,
      });

      this.graphExtractionQueue.on(
        'taskProgress',
        (eventData: { taskId: string; progress: number; data: unknown }) => {
          this.emit('graphExtraction:taskProgress', eventData);
        }
      );
      this.graphExtractionQueue.on('taskCompleted', (eventData: { taskId: string; result: unknown }) => {
        this.emit('graphExtraction:taskCompleted', eventData);
      });
      this.graphExtractionQueue.on('taskFailed', (task: { id: string; error?: string }) => {
        this.emit('graphExtraction:taskFailed', { taskId: task.id, error: task.error });
      });
    } catch (error) {
      this.graphExtractionQueue = null;
      console.warn('[QueueManager] 图谱抽取队列初始化失败（将跳过图谱抽取）:', error);
    }

    // 初始化“可选队列”：图谱向量索引（低优先级，默认单并发）
    try {
      this.graphIndexingQueue = new WorkerThreadQueue<GraphIndexingJobPayloadInput>({
        maxConcurrency: 1,
        workerScript: options.workerRuntime.graphIndexingScriptPath,
        runtimePathRoots: options.runtimePathRoots,
        distributionIdentity: options.distributionIdentity,
      });

      this.graphIndexingQueue.on(
        'taskProgress',
        (eventData: { taskId: string; progress: number; data: unknown }) => {
          this.emit('graphIndexing:taskProgress', eventData);
        }
      );
      this.graphIndexingQueue.on('taskCompleted', (eventData: { taskId: string; result: unknown }) => {
        this.emit('graphIndexing:taskCompleted', eventData);
      });
      this.graphIndexingQueue.on('taskFailed', (task: { id: string; error?: string }) => {
        this.emit('graphIndexing:taskFailed', { taskId: task.id, error: task.error });
      });
    } catch (error) {
      this.graphIndexingQueue = null;
      console.warn('[QueueManager] 图谱索引队列初始化失败（将跳过图谱向量化）:', error);
    }

    console.log('[QueueManager] 任务队列系统初始化完成');
  }

  /**
   * 功能 (What): 添加文档摄入任务
   * 输入 (Input): 摄入任务数据
   * 输出 (Output): 任务ID
   * 副作用 (Side-effects): 将任务添加到队列中
   */
  async addIngestionTask(taskData: IngestionJobPayload): Promise<string> {
    if (!this.ingestionQueue) {
      throw new Error('摄入队列未初始化');
    }
    const taskWithWorkerEnv: IngestionJobPayload = {
      ...taskData,
      envVars: {
        ...taskData.envVars,
        ...(this.qdrantUrl ? { QDRANT_URL: this.qdrantUrl } : {}),
      },
    };
    return await this.ingestionQueue.addTask(taskWithWorkerEnv);
  }

  /**
   * 功能 (What): 添加图谱抽取任务（Milestone 3）
   * 输入 (Input): 图谱抽取任务数据
   * 输出 (Output): 任务ID
   * 副作用 (Side-effects): 将任务添加到图谱抽取队列中
   */
  async addGraphExtractionTask(taskData: GraphExtractionJobPayloadInput): Promise<string> {
    if (!this.graphExtractionQueue) {
      throw new Error('图谱抽取队列未初始化');
    }
    return await this.graphExtractionQueue.addTask(taskData);
  }

  /**
   * 功能 (What): 添加图谱向量索引任务（M5）
   * 输入 (Input): 图谱索引任务数据
   * 输出 (Output): 任务ID
   * 副作用 (Side-effects): 将任务添加到图谱索引队列中
   */
  async addGraphIndexingTask(taskData: GraphIndexingJobPayloadInput): Promise<string> {
    if (!this.graphIndexingQueue) {
      throw new Error('图谱索引队列未初始化');
    }
    return await this.graphIndexingQueue.addTask(taskData);
  }

  /**
   * 功能 (What): 流式处理音频文件
   * 输入 (Input): 音频文件路径和配置
   * 输出 (Output): EventEmitter（可监听 progress, segment, done, error 事件）
   * 副作用 (Side-effects): 在后台线程中流式处理音频解码、重采样和切分
   */
  processAudio(filePath: string, config: AudioPreprocessingConfig): EventEmitter {
    return this.audioProcessingQueue.processAudio(filePath, config);
  }

  /**
   * 功能 (What): 取消摄入任务
   * 输入 (Input): 任务ID
   * 输出 (Output): 是否成功取消
   * 副作用 (Side-effects): 中断任务执行
   */
  async cancelIngestionTask(taskId: string): Promise<boolean> {
    if (!this.ingestionQueue) {
      throw new Error('摄入队列未初始化');
    }
    return await this.ingestionQueue.cancelTask(taskId);
  }

  /**
   * **功能 (What):** 列出图谱抽取队列中的任务（只读快照）
   * **输入 (Input):** 无
   * **输出 (Output):** Worker job 快照（用于上层做过滤/取消等业务编排）
   * **副作用 (Side-effects):** 无
   *
   * 说明：QueueManager 只提供“队列可观测性”，不负责具体领域过滤策略。
   */
  listGraphExtractionTasks(): ReadonlyArray<WorkerJob<GraphExtractionJobPayloadInput>> {
    if (!this.graphExtractionQueue) return [];
    return this.graphExtractionQueue.listTasks();
  }

  /**
   * **功能 (What):** 列出图谱索引队列中的任务（只读快照）
   */
  listGraphIndexingTasks(): ReadonlyArray<WorkerJob<GraphIndexingJobPayloadInput>> {
    if (!this.graphIndexingQueue) return [];
    return this.graphIndexingQueue.listTasks();
  }

  /**
   * **功能 (What):** 取消一个图谱抽取任务（按 taskId）
   */
  async cancelGraphExtractionTask(taskId: string): Promise<boolean> {
    if (!this.graphExtractionQueue) return false;
    return await this.graphExtractionQueue.cancelTask(taskId);
  }

  /**
   * **功能 (What):** 取消一个图谱索引任务（按 taskId）
   */
  async cancelGraphIndexingTask(taskId: string): Promise<boolean> {
    if (!this.graphIndexingQueue) return false;
    return await this.graphIndexingQueue.cancelTask(taskId);
  }

  /**
   * 功能 (What): 暂停摄入任务
   * 输入 (Input): 任务ID
   * 输出 (Output): 是否成功暂停
   * 副作用 (Side-effects): 暂停任务执行
   */
  async pauseIngestionTask(taskId: string): Promise<boolean> {
    if (!this.ingestionQueue) {
      throw new Error('摄入队列未初始化');
    }
    return await this.ingestionQueue.pauseTask(taskId);
  }

  /**
   * 功能 (What): 恢复摄入任务
   * 输入 (Input): 任务ID
   * 输出 (Output): 是否成功恢复
   * 副作用 (Side-effects): 恢复任务执行
   */
  async resumeIngestionTask(taskId: string): Promise<boolean> {
    if (!this.ingestionQueue) {
      throw new Error('摄入队列未初始化');
    }
    return await this.ingestionQueue.resumeTask(taskId);
  }

  /**
   * 功能 (What): 获取任务状态
   * 输入 (Input): 任务ID列表
   * 输出 (Output): 任务状态映射
   * 副作用 (Side-effects): 无
   */
  getTaskStatuses(taskIds: string[]): Record<string, unknown> {
    if (!this.ingestionQueue) {
      throw new Error('队列管理器未初始化');
    }
    return this.ingestionQueue.getTaskStatuses(taskIds);
  }

  /**
   * 功能 (What): 获取队列统计信息
   * 输入 (Input): 无
   * 输出 (Output): 队列统计
   * 副作用 (Side-effects): 无
   */
  getQueueStats() {
    if (!this.ingestionQueue) {
      throw new Error('队列管理器未初始化');
    }
    return this.ingestionQueue.getQueueStats();
  }

  /**
   * 功能 (What): 通过任务ID获取任务
   * 输入 (Input): 任务ID
   * 输出 (Output): 任务对象或undefined
   * 副作用 (Side-effects): 无
   */
  getTaskById(taskId: string): IngestionWorkerJob | undefined {
    if (!this.ingestionQueue) {
      throw new Error('队列管理器未初始化');
    }
    const task = this.ingestionQueue.getTask(taskId);
    if (!task) return undefined;
    return {
      id: task.id,
      data: task.data,
      state: task.state,
      progress: task.progress,
      result: task.result,
      error: task.error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  /**
   * 功能 (What): 关闭队列管理器
   * 输入 (Input): 无
   * 输出 (Output): 无
   * 副作用 (Side-effects): 清理所有队列和工作线程
   */
  async shutdown(): Promise<void> {
    console.log('[QueueManager] 正在关闭任务队列系统...');
    
    // 关闭文档摄入队列
    if (this.ingestionQueue) {
      await this.ingestionQueue.shutdown();
      this.ingestionQueue = null;
    }

    // 关闭图谱抽取队列
    if (this.graphExtractionQueue) {
      await this.graphExtractionQueue.shutdown();
      this.graphExtractionQueue = null;
    }

    // 关闭图谱索引队列
    if (this.graphIndexingQueue) {
      await this.graphIndexingQueue.shutdown();
      this.graphIndexingQueue = null;
    }
    
    // 关闭音频处理队列
    await this.audioProcessingQueue.shutdown();
    
    console.log('[QueueManager] 任务队列系统已关闭');
  }
}

// 导出单例实例
export const queueManager = QueueManager.getInstance();
