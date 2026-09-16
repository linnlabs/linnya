import type { ManualEditIntent } from './manualEditingTypes';

/** 多个连续绝对修改可以共用一次编译，但每个调用方都必须收到自己的结果。 */
export interface ManualEditQueueEntry {
  readonly intent: ManualEditIntent;
  readonly clientOperationIds: readonly [string, ...string[]];
}

export type ManualEditSubmissionState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'submitting'; readonly entry: ManualEditQueueEntry; readonly commandId: string }
  | { readonly phase: 'awaiting_frame'; readonly entry: ManualEditQueueEntry; readonly commandId: string; readonly revision: number };

export type ManualEditSettlement =
  | { readonly status: 'presented'; readonly commandId: string; readonly revision: number }
  | { readonly status: 'failed'; readonly commandId: string; readonly message: string }
  | { readonly status: 'blocked'; readonly dependencyCommandId: string; readonly message: string }
  | { readonly status: 'cancelled' };

export interface ManualEditTicket {
  readonly clientOperationId: string;
  readonly settled: Promise<ManualEditSettlement>;
}

/** 交互只接收身份明确的回执，不观察全局 submitting 布尔边沿。 */
export interface ManualEditSubmissionPort {
  readonly enqueue: (intent: ManualEditIntent) => ManualEditTicket;
  readonly refreshPresentation: () => Promise<void>;
}
