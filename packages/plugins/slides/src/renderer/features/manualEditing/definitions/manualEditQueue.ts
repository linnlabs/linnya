import type { SlidesManualEditHistoryFocus } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditIntent } from './manualEditingTypes';

/** 一条队列记录对应一个已完成的用户动作及其回执。 */
export interface ManualEditQueueEntry {
  readonly intent: ManualEditIntent;
  readonly clientOperationIds: readonly [string, ...string[]];
}

export type ManualEditSubmissionState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'submitting'; readonly entry: ManualEditQueueEntry; readonly commandId: string }
  | { readonly phase: 'awaiting_frame'; readonly entry: ManualEditQueueEntry; readonly commandId: string; readonly revision: number;
      readonly focus?: SlidesManualEditHistoryFocus };

export type ManualEditSettlement =
  | { readonly status: 'presented'; readonly commandId: string; readonly revision: number; readonly focus?: SlidesManualEditHistoryFocus }
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
  /** 等待已接纳修改落盘；最后一帧尚未呈现不影响保存成功。 */
  readonly flush: () => Promise<void>;
  readonly refreshPresentation: () => Promise<void>;
}
