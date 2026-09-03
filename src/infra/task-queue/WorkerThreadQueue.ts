/**
 * @file src/task-queue/WorkerThreadQueue.ts
 * 
 * @brief 基于 Worker Threads 的任务队列（独立文件）
 * 
 * @description
 * 功能 (What): 管理后台任务的排队、并发与工作线程生命周期；处理来自 Worker 的消息并发射事件
 * 输入 (Input): 泛型任务负载（至少包含 taskId）
 * 输出 (Output): 事件（taskStarted/taskProgress/taskCompleted/taskFailed）与查询接口
 * 副作用 (Side-effects): 创建/终止 worker 线程，并把通用生命周期通知给显式注入的 observer
 */

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { calculateOptimalConcurrency } from './concurrency';
import { readDiagnosticLogEnvelope } from '../../shared/logging';
import { writeForwardedDiagnosticLogRecord } from '../../shared/logger';
import type { RuntimePathRoots } from '../../shared/runtime-paths';

/**
 * 任务状态枚举
 */
export enum WorkerJobState {
  PENDING = 'pending',
  RUNNING = 'running', 
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/**
 * 任务对象接口
 */
export type BaseWorkerJobPayload = {
  taskId: string;
};

export interface WorkerJob<TPayload extends BaseWorkerJobPayload> {
  id: string;
  data: TPayload;
  state: WorkerJobState;
  progress: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface WorkerJobLifecycleObserver<TPayload extends BaseWorkerJobPayload> {
  onProgress?(event: {
    readonly job: Readonly<WorkerJob<TPayload>>;
    readonly data: unknown;
  }): void;
  onCompleted?(event: {
    readonly job: Readonly<WorkerJob<TPayload>>;
    readonly result: unknown;
  }): void;
}

/**
 * 功能 (What): 基于 Worker Threads 的任务队列
 * 输入 (Input): 任务配置和任务数据
 * 输出 (Output): 任务执行结果和状态更新（通过事件）
 * 副作用 (Side-effects): 创建工作线程，执行文档摄入任务
 */
export class WorkerThreadQueue<TPayload extends BaseWorkerJobPayload> extends EventEmitter {
  private jobs: Map<string, WorkerJob<TPayload>> = new Map();
  private runningJobs: Set<string> = new Set();
  private workers: Worker[] = [];
  private workerJobMap: Map<string, Worker> = new Map(); // Worker job ID 到 Worker 的映射
  private forcedTerminationTimers: Map<string, NodeJS.Timeout> = new Map();
  private maxConcurrency: number;
  private workerScript: string;
  private readonly lifecycleObserver?: WorkerJobLifecycleObserver<TPayload>;
  private readonly runtimePathRoots?: RuntimePathRoots;
  private shuttingDown = false;

  constructor(options: {
    maxConcurrency?: number;
    workerScript: string;
    lifecycleObserver?: WorkerJobLifecycleObserver<TPayload>;
    runtimePathRoots?: RuntimePathRoots;
  }) {
    super();
    // 注意：maxConcurrency=0 在语义上表示“暂停队列，不自动启动任何任务”
    // 因此这里必须用 ?? 而不是 ||，避免 0 被当成 falsy 而回落到默认并发数。
    this.maxConcurrency = options.maxConcurrency ?? calculateOptimalConcurrency();
    this.workerScript = options.workerScript;
    this.lifecycleObserver = options.lifecycleObserver;
    this.runtimePathRoots = options.runtimePathRoots;

    // 🔍 初始化诊断日志
    console.log(`[WorkerQueue] 初始化: maxConcurrency=${this.maxConcurrency}, workerScript=${this.workerScript}`);
  }

  /**
   * 功能 (What): 添加任务到队列
   * 输入 (Input): 任务数据
   * 输出 (Output): 任务ID
   * 副作用 (Side-effects): 创建任务记录，触发处理
   */
  async addTask(taskData: TPayload): Promise<string> {
    if (this.shuttingDown) throw new Error('任务队列正在关闭，不能接收新任务');
    const task: WorkerJob<TPayload> = {
      id: taskData.taskId,
      data: taskData,
      state: WorkerJobState.PENDING,
      progress: 0,
      createdAt: Date.now()
    };

    this.jobs.set(task.id, task);
    console.log(`[WorkerQueue] 任务已添加到队列: ${task.id}`);

    // 触发任务处理
    this.processQueue();

    return task.id;
  }

  /**
   * 功能 (What): 处理队列中的待处理任务
   * 输入 (Input): 无
   * 输出 (Output): 无
   * 副作用 (Side-effects): 启动Worker线程执行任务
   */
  private async processQueue(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.runningJobs.size >= this.maxConcurrency) {
      return;
    }

    const pendingJob = Array.from(this.jobs.values())
      .find(job => job.state === WorkerJobState.PENDING);

    if (!pendingJob) {
      return;
    }

    await this.executeJob(pendingJob);
  }

  /**
   * 功能 (What): 在Worker线程中执行任务
   * 输入 (Input): 任务对象
   * 输出 (Output): 无
   * 副作用 (Side-effects): 创建Worker线程，更新任务状态
   */
  private async executeJob(job: WorkerJob<TPayload>): Promise<void> {
    console.log(`[WorkerQueue] 开始执行任务: ${job.id}`);

    // 更新任务状态
    job.state = WorkerJobState.RUNNING;
    job.startedAt = Date.now();
    this.runningJobs.add(job.id);
    this.emit('taskStarted', job);

    try {
      const worker = new Worker(this.workerScript, {
        workerData: {
          ...job.data,
          ...(this.runtimePathRoots ? { runtimePathRoots: this.runtimePathRoots } : {}),
        },
        env: process.env
      });

      this.workers.push(worker);
      this.workerJobMap.set(job.id, worker);

      worker.on('message', (message: unknown) => {
        this.handleWorkerMessage(job.id, message);
      });

      worker.on('error', (error: Error) => {
        console.error(`[WorkerQueue] Worker错误 (任务 ${job.id}):`, error.message);
        this.handleJobFailure(job.id, error.message);
      });

      worker.on('exit', (code: number) => {
        this.cleanupWorker(worker);
        this.workerJobMap.delete(job.id);
        this.clearForcedTerminationTimer(job.id);

        // terminate() 在 shutdown 中通常返回非零退出码，这是 owner 收口，不是业务失败。
        if (this.shuttingDown) return;

        const currentJob = this.jobs.get(job.id);
        if (currentJob && currentJob.state === WorkerJobState.RUNNING) {
          this.handleJobFailure(job.id, `Worker意外退出，退出码: ${code}`);
        }
      });

    } catch (error) {
      console.error(`[WorkerQueue] 创建Worker失败 (任务 ${job.id}):`, error);
      this.handleJobFailure(job.id, error instanceof Error ? error.message : '创建Worker失败');
    }
  }

  /**
   * 功能 (What): 处理Worker发送的消息
   * 输入 (Input): 任务ID和消息内容
   * 输出 (Output): 无
   * 副作用 (Side-effects): 更新任务状态和进度
   */
  private handleWorkerMessage(taskId: string, message: unknown): void {
    try {
      const diagnosticLog = readDiagnosticLogEnvelope(message);
      if (diagnosticLog) {
        // Worker 只转发已经有界的记录；活动文件仍由 Electron App owner 独占写入。
        writeForwardedDiagnosticLogRecord(diagnosticLog.record);
        return;
      }
      const job = this.jobs.get(taskId);
      if (!job) {
        console.warn(`[WorkerQueue] 收到未知任务的消息: ${taskId}`);
        return;
      }

      if (!message || typeof message !== 'object') {
        console.warn('[WorkerQueue] 收到非法 Worker 消息（非对象）');
        return;
      }

      const msgType = (message as { type?: unknown }).type;

      if (msgType === 'progress') {
        const frontendState = (message as { frontendState?: unknown }).frontendState;
        const progressValue =
          frontendState &&
          typeof frontendState === 'object' &&
          typeof (frontendState as { progress?: unknown }).progress === 'number'
            ? (frontendState as { progress: number }).progress
            : 0;

        job.progress = progressValue;
        job.result = frontendState;
        this.lifecycleObserver?.onProgress?.({ job: { ...job }, data: frontendState });
        this.emit('taskProgress', { taskId, progress: job.progress, data: frontendState });

      } else if (msgType === 'completed') {
        job.state = WorkerJobState.COMPLETED;
        job.progress = 100;
        job.result = (message as { result?: unknown }).result;
        job.completedAt = Date.now();

        this.runningJobs.delete(taskId);
        const worker = this.workerJobMap.get(taskId);
        if (worker) {
          this.terminateFinishedWorker(worker);
        }

        const result = (message as { result?: unknown }).result;
        this.lifecycleObserver?.onCompleted?.({ job: { ...job }, result });
        this.emit('taskCompleted', { taskId, result });

        job.result = undefined;
        this.pruneCompletedHistory(50);
        if (!worker) void this.processQueue();

      } else if (msgType === 'failed') {
        const err = (message as { error?: unknown }).error;
        this.handleJobFailure(taskId, typeof err === 'string' && err.trim() ? err : '未知错误');
      }
    } catch (error) {
      console.error(`[WorkerQueue] 处理Worker消息失败:`, error);
      this.handleJobFailure(taskId, `消息处理失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 功能 (What): 处理任务失败
   * 输入 (Input): 任务ID和错误信息
   * 输出 (Output): 无
   * 副作用 (Side-effects): 更新任务状态，清理资源
   */
  private handleJobFailure(taskId: string, error: string): void {
    const job = this.jobs.get(taskId);
    if (!job) return;

    job.state = WorkerJobState.FAILED;
    job.error = error;
    job.completedAt = Date.now();
    this.runningJobs.delete(taskId);

    const worker = this.workerJobMap.get(taskId);
    if (worker) {
      this.terminateFinishedWorker(worker);
    }

    console.error(`[WorkerQueue] 任务 ${taskId} 失败: ${error}`);
    this.emit('taskFailed', job);

    // 失败进度由摄取状态机负责写入；通用队列不能绕过状态机重复更新领域读模型。

    this.pruneCompletedHistory(50);
    if (!worker) void this.processQueue();
  }

  private terminateFinishedWorker(worker: Worker): void {
    // terminate() resolve 前仍保留在 workers registry；否则 App shutdown 会误判线程已归零。
    void worker.terminate()
      .catch(error => console.warn('[WorkerQueue] 终止已完成 Worker 失败:', error))
      .finally(() => {
        if (!this.shuttingDown) void this.processQueue();
      });
  }

  /**
   * 功能 (What): 清理Worker资源
   * 输入 (Input): Worker实例
   * 输出 (Output): 无
   * 副作用 (Side-effects): 从workers数组中移除Worker
   */
  private cleanupWorker(worker: Worker): void {
    const index = this.workers.indexOf(worker);
    if (index > -1) {
      this.workers.splice(index, 1);
    }
  }

  /**
   * 功能 (What): 获取任务状态
   * 输入 (Input): 任务ID
   * 输出 (Output): 任务对象或undefined
   * 副作用 (Side-effects): 无
   */
  getTask(taskId: string): WorkerJob<TPayload> | undefined {
    return this.jobs.get(taskId);
  }

  /**
   * **功能 (What):** 获取队列内任务快照（只读）
   * **输入 (Input):** 无
   * **输出 (Output):** 任务数组（浅拷贝），用于上层做过滤/统计/批量取消
   * **副作用 (Side-effects):** 无
   *
   * 说明：
   * - 返回的是“快照”，避免上层拿到内部 Map 引用后发生误改；
   * - `data` 仍是浅引用（payload 一般视为不可变对象），若需要深拷贝请在上层自行处理。
   */
  listTasks(): ReadonlyArray<WorkerJob<TPayload>> {
    return Array.from(this.jobs.values()).map((job) => ({ ...job }));
  }

  /**
   * 功能 (What): 获取多个任务的状态
   * 输入 (Input): 任务ID数组
   * 输出 (Output): 任务状态映射
   * 副作用 (Side-effects): 无
   */
  getTaskStatuses(taskIds: string[]): Record<string, unknown> {
    const statuses: Record<string, unknown> = {};

    for (const taskId of taskIds) {
      const job = this.jobs.get(taskId);
      if (job) {
        statuses[taskId] = {
          state: job.state,
          progress: job.progress,
          error: job.error,
          result: job.result,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt
        };
      } else {
        statuses[taskId] = { state: 'NOT_FOUND' };
      }
    }

    return statuses;
  }

  /**
   * 功能 (What): 获取队列统计信息
   * 输入 (Input): 无
   * 输出 (Output): 队列统计对象
   * 副作用 (Side-effects): 无
   */
  getQueueStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      total: jobs.length,
      pending: jobs.filter(job => job.state === WorkerJobState.PENDING).length,
      running: jobs.filter(job => job.state === WorkerJobState.RUNNING).length,
      completed: jobs.filter(job => job.state === WorkerJobState.COMPLETED).length,
      failed: jobs.filter(job => job.state === WorkerJobState.FAILED).length
    };
  }

  /**
   * 功能 (What): 关闭队列，清理所有资源
   * 输入 (Input): 无
   * 输出 (Output): 无
   * 副作用 (Side-effects): 终止所有Worker线程，清理内存
   */
  async shutdown(): Promise<void> {
    console.log('[WorkerQueue] 正在关闭任务队列...');
    this.shuttingDown = true;

    const terminatePromises = this.workers.map(worker => 
      worker.terminate().catch(err => 
        console.warn('[WorkerQueue] 终止Worker失败:', err)
      )
    );

    await Promise.all(terminatePromises);

    for (const timer of this.forcedTerminationTimers.values()) {
      clearTimeout(timer);
    }

    this.jobs.clear();
    this.runningJobs.clear();
    this.workers = [];
    this.workerJobMap.clear();
    this.forcedTerminationTimers.clear();

    console.log('[WorkerQueue] 任务队列已关闭');
  }

  /**
   * 功能 (What): 取消指定任务
   * 输入 (Input): 任务ID
   * 输出 (Output): 是否成功取消
   * 副作用 (Side-effects): 中断Worker线程，更新任务状态
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const job = this.jobs.get(taskId);
    if (!job) {
      console.warn(`[WorkerQueue] 尝试取消不存在的任务: ${taskId}`);
      return false;
    }

    console.log(`[WorkerQueue] 取消任务: ${taskId} (当前状态: ${job.state})`);

    if (job.state === WorkerJobState.PENDING) {
      job.state = WorkerJobState.FAILED;
      job.error = '用户取消';
      job.completedAt = Date.now();
      this.emit('taskFailed', job);
      return true;
    }

    if (job.state === WorkerJobState.RUNNING) {
      const worker = this.workerJobMap.get(taskId);
      if (worker) {
        worker.postMessage({ cmd: 'cancel' });

        this.clearForcedTerminationTimer(taskId);
        const forcedTerminationTimer = setTimeout(() => {
          this.forcedTerminationTimers.delete(taskId);
          if (this.workerJobMap.has(taskId)) {
            console.log(`[WorkerQueue] 强制终止任务 ${taskId} 的Worker`);
            void worker.terminate();
          }
        }, 5000);
        forcedTerminationTimer.unref();
        this.forcedTerminationTimers.set(taskId, forcedTerminationTimer);

        return true;
      }
    }

    return false;
  }

  /**
   * 功能 (What): 暂停指定任务
   * 输入 (Input): 任务ID
   * 输出 (Output): 是否成功暂停
   * 副作用 (Side-effects): 向Worker发送暂停信号
   */
  async pauseTask(taskId: string): Promise<boolean> {
    const job = this.jobs.get(taskId);
    if (!job) {
      console.warn(`[WorkerQueue] 尝试暂停不存在的任务: ${taskId}`);
      return false;
    }

    console.log(`[WorkerQueue] 暂停任务: ${taskId}`);

    if (job.state === WorkerJobState.RUNNING) {
      const worker = this.workerJobMap.get(taskId);
      if (worker) {
        worker.postMessage({ cmd: 'pause' });
        return true;
      }
    }

    return false;
  }

  /**
   * 功能 (What): 恢复指定任务
   * 输入 (Input): 任务ID
   * 输出 (Output): 是否成功恢复
   * 副作用 (Side-effects): 重新启动被暂停的任务
   */
  async resumeTask(taskId: string): Promise<boolean> {
    const job = this.jobs.get(taskId);
    if (!job) {
      console.warn(`[WorkerQueue] 尝试恢复不存在的任务: ${taskId}`);
      return false;
    }

    console.log(`[WorkerQueue] 恢复任务: ${taskId}`);

    if (job.state === WorkerJobState.FAILED && job.error?.includes('暂停')) {
      job.state = WorkerJobState.PENDING;
      job.error = undefined;
      job.startedAt = undefined;
      job.completedAt = undefined;
      this.processQueue();
      return true;
    }

    return false;
  }

  /**
   * 功能 (What): 修剪已完成/失败任务历史，保留最近的若干条
   * 输入 (Input): 最大保留条数
   * 输出 (Output): 无
   * 副作用 (Side-effects): 从内存中删除过期任务记录
   */
  private pruneCompletedHistory(maxKeep: number = 50): void {
    const finished = Array.from(this.jobs.values()).filter(job => job.state === WorkerJobState.COMPLETED || job.state === WorkerJobState.FAILED);
    if (finished.length <= maxKeep) return;

    finished.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    const toDelete = finished.slice(maxKeep);
    for (const t of toDelete) {
      this.jobs.delete(t.id);
    }
  }

  private clearForcedTerminationTimer(taskId: string): void {
    const timer = this.forcedTerminationTimers.get(taskId);
    if (!timer) return;
    clearTimeout(timer);
    this.forcedTerminationTimers.delete(taskId);
  }
}
