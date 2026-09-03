export interface QueueJobProgressPresentation {
  readonly jobId: string;
  readonly progress: number;
  readonly data: unknown;
}

export interface QueueJobCompletionPresentation {
  readonly jobId: string;
  readonly result: unknown;
}

export interface QueueJobFailurePresentation {
  readonly jobId: string;
  readonly jobData: unknown;
  readonly errorMessage?: string;
  readonly failedMessage: string;
}

/** 通用队列只发布 job 事实，不知道 Electron、窗口或 Renderer channel。 */
export interface QueueJobPresentationPublisher {
  publishProgress(event: QueueJobProgressPresentation): void;
  publishCompletion(event: QueueJobCompletionPresentation): void;
  publishFailure(event: QueueJobFailurePresentation): void;
}
