/**
 * @file src/infra/task-queue/AudioProcessingQueue.ts
 *
 * @description
 * 音频解码、重采样和切分 Worker 的进程内 owner。脚本路径由 App composition
 * 显式注入；shutdown 必须等待全部已启动 Worker 真实退出，并取消尚未启动的 launch。
 */

import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { v4 as uuidv4 } from 'uuid';

import type { AudioPreprocessingConfig } from '../../features/transcription/audio-preprocessing/config';
import { Logger } from '../../shared/logger';
import type {
  AudioProcessingWorkerInput,
  AudioProcessingWorkerOutput,
} from './definitions/audioProcessingWorkerProtocol';

const logger = new Logger('AudioProcessingQueue');

interface OwnedAudioWorker {
  readonly id: string;
  readonly worker: Worker;
  readonly emitter: EventEmitter;
  completed: boolean;
  failurePublished: boolean;
  terminationKind: 'none' | 'failure' | 'shutdown';
}

/** 独立音频 Worker owner；生命周期由 QueueManager 统一收口。 */
export class AudioProcessingQueue extends EventEmitter {
  private isInitialized = false;
  private shuttingDown = false;
  private workerScript: string | null = null;
  private readonly activeWorkers = new Set<OwnedAudioWorker>();
  private readonly pendingLaunches = new Map<NodeJS.Immediate, EventEmitter>();
  private shutdownSettlement: Promise<void> | null = null;

  async initialize(workerScript: string): Promise<void> {
    if (this.shuttingDown || this.shutdownSettlement) {
      throw new Error('音频处理队列正在关闭');
    }
    if (this.isInitialized) {
      if (this.workerScript !== workerScript) {
        throw new Error('音频处理队列已绑定另一份 Worker runtime');
      }
      return;
    }

    this.workerScript = workerScript;
    this.isInitialized = true;
    logger.info('音频处理队列初始化完成', { workerScript });
  }

  /**
   * 处理音频（流式处理，返回 EventEmitter）。
   *
   * 事件保持既有 `progress / segment / done / error` 协议，避免转录 UI/UX 回归。
   */
  processAudio(filePath: string, config: AudioPreprocessingConfig): EventEmitter {
    if (!this.isInitialized || !this.workerScript || this.shuttingDown) {
      throw new Error('音频处理队列未初始化');
    }

    const workerScript = this.workerScript;
    const taskId = `audio_${uuidv4()}`;
    const emitter = new EventEmitter();
    logger.info(`开始音频流式处理任务: ${taskId}, 文件: ${filePath}`);

    const launch = setImmediate(() => {
      this.pendingLaunches.delete(launch);
      if (!this.isInitialized || this.shuttingDown) {
        emitter.emit('error', new Error('音频处理任务因队列关闭而取消'));
        return;
      }
      this.startWorker({ taskId, filePath, config, workerScript, emitter });
    });
    this.pendingLaunches.set(launch, emitter);

    return emitter;
  }

  shutdown(): Promise<void> {
    if (this.shutdownSettlement) return this.shutdownSettlement;

    const settlement = this.shutdownOnce();
    const trackedSettlement = settlement.finally(() => {
      if (this.shutdownSettlement === trackedSettlement) {
        this.shutdownSettlement = null;
      }
    });
    this.shutdownSettlement = trackedSettlement;
    return trackedSettlement;
  }

  private startWorker(input: {
    readonly taskId: string;
    readonly filePath: string;
    readonly config: AudioPreprocessingConfig;
    readonly workerScript: string;
    readonly emitter: EventEmitter;
  }): void {
    try {
      const worker = new Worker(input.workerScript);
      const owned: OwnedAudioWorker = {
        id: input.taskId,
        worker,
        emitter: input.emitter,
        completed: false,
        failurePublished: false,
        terminationKind: 'none',
      };
      this.activeWorkers.add(owned);

      worker.on('message', (message: AudioProcessingWorkerOutput) => {
        this.handleWorkerMessage(owned, message);
      });
      worker.on('error', (error: Error) => {
        if (owned.terminationKind === 'shutdown' || owned.failurePublished) return;
        owned.failurePublished = true;
        logger.error(`音频处理 Worker 错误: ${owned.id}`, error);
        owned.emitter.emit('error', error);
        this.requestTermination(owned, 'failure');
      });
      worker.on('exit', (code: number) => {
        this.activeWorkers.delete(owned);
        if (owned.terminationKind === 'shutdown') return;

        if (code !== 0 && !owned.completed && !owned.failurePublished) {
          owned.failurePublished = true;
          const error = new Error(`音频处理 Worker 异常退出，退出码: ${code}`);
          logger.error(`音频处理 Worker 退出: ${owned.id}`, error);
          owned.emitter.emit('error', error);
        } else if (code !== 0 && owned.completed) {
          logger.warn(`音频处理 Worker 在任务完成后以退出码 ${code} 结束: ${owned.id}`);
        }
      });

      const workerInput: AudioProcessingWorkerInput = {
        filePath: input.filePath,
        config: input.config,
      };
      worker.postMessage(workerInput);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`创建音频处理 Worker 失败: ${input.taskId}`, errorMessage);
      input.emitter.emit('error', new Error(`创建音频处理 Worker 失败: ${errorMessage}`));
    }
  }

  private handleWorkerMessage(
    owned: OwnedAudioWorker,
    message: AudioProcessingWorkerOutput,
  ): void {
    switch (message.type) {
      case 'started':
        logger.debug(`音频处理任务已启动: ${owned.id}`);
        return;
      case 'progress':
        owned.emitter.emit('progress', {
          percent: message.percent,
          stage: message.stage,
          bytesProcessed: message.bytesProcessed,
          totalBytes: message.totalBytes,
        });
        return;
      case 'segment':
        owned.emitter.emit('segment', message.segment);
        return;
      case 'done':
        owned.completed = true;
        logger.info(`音频处理任务完成: ${owned.id}, 总片段数: ${message.totalSegments}`);
        owned.emitter.emit('done', {
          totalSegments: message.totalSegments,
          totalDuration: message.totalDuration,
          stats: message.stats,
        });
        return;
      case 'failed': {
        owned.failurePublished = true;
        const error = new Error(message.error || '音频处理失败');
        logger.error(`音频处理任务失败: ${owned.id}`, error);
        owned.emitter.emit('error', error);
        this.requestTermination(owned, 'failure');
      }
    }
  }

  private requestTermination(
    owned: OwnedAudioWorker,
    kind: OwnedAudioWorker['terminationKind'],
  ): void {
    if (owned.terminationKind !== 'none') return;
    owned.terminationKind = kind;
    void owned.worker.terminate().catch((error: unknown) => {
      logger.error(`终止音频处理 Worker 失败: ${owned.id}`, error);
    });
  }

  private async shutdownOnce(): Promise<void> {
    logger.info('音频处理队列正在关闭...');
    this.shuttingDown = true;
    this.isInitialized = false;

    const cancellationError = new Error('音频处理任务因队列关闭而取消');
    for (const [launch, emitter] of this.pendingLaunches) {
      clearImmediate(launch);
      emitter.emit('error', cancellationError);
    }
    this.pendingLaunches.clear();

    const activeWorkers = [...this.activeWorkers];
    await Promise.all(activeWorkers.map(async owned => {
      owned.terminationKind = 'shutdown';
      if (!owned.completed && !owned.failurePublished) {
        owned.emitter.emit('error', cancellationError);
      }
      await owned.worker.terminate();
    }));

    this.activeWorkers.clear();
    this.workerScript = null;
    this.shuttingDown = false;
    logger.info('音频处理队列已关闭');
  }
}
