import { EventEmitter } from 'node:events';
import { AudioProcessingQueue } from './AudioProcessingQueue';
import type { AudioPreprocessingConfig } from '../../features/transcription/audio-preprocessing/config';
import type { QueueWorkerRuntime } from './definitions/queueWorkerRuntime';

export interface QueueManagerInitializeOptions {
  workerRuntime: QueueWorkerRuntime;
}

/** Host 仅拥有音频预处理；插件队列由各自 activation 关闭，不能互相停掉。 */
export class QueueManager extends EventEmitter {
  private static instance: QueueManager | null = null;
  private readonly audioProcessingQueue = new AudioProcessingQueue();
  private initializationFailure: string | null = null;
  protected constructor() {
    super();
  }
  static getInstance(): QueueManager {
    return (QueueManager.instance ??= new QueueManager());
  }
  async initialize(options: QueueManagerInitializeOptions): Promise<void> {
    this.initializationFailure = null;
    try {
      await this.audioProcessingQueue.initialize(options.workerRuntime.audioProcessingScriptPath);
    } catch (error) {
      this.initializationFailure = error instanceof Error ? error.message : String(error);
      await this.audioProcessingQueue.shutdown();
      throw error;
    }
  }
  processAudio(filePath: string, config: AudioPreprocessingConfig): EventEmitter {
    if (this.initializationFailure)
      throw new Error(`音频处理队列未启动：${this.initializationFailure}`);
    return this.audioProcessingQueue.processAudio(filePath, config);
  }
  hasActiveTasks(): boolean {
    return this.audioProcessingQueue.hasActiveTasks();
  }
  shutdown(): Promise<void> {
    return this.audioProcessingQueue.shutdown();
  }
}
export const queueManager = QueueManager.getInstance();
