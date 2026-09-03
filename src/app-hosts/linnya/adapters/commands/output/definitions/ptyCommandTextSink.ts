import type {
  PtyCommandAgentTextProjection,
  PtyTerminalScreenProjection,
} from '../../../../../../domains/commands';
import type {
  PtyCommandOutputObservationController,
  PtyScreenProjectionOptions,
} from '../../../../../../infra/adapters/command-runtime/pty';
import type {
  ToolOutputTextBlobSaveResult,
  ToolOutputTextBlobWriter,
} from '../../../../../../tools/tool_output';

export interface PtyCommandTextSinkLimits {
  readonly maxPendingEvents: number;
  readonly maxPendingBytes: number;
}

export const DEFAULT_PTY_COMMAND_TEXT_SINK_LIMITS: PtyCommandTextSinkLimits = Object.freeze({
  maxPendingEvents: 1_024,
  maxPendingBytes: 4 * 1_024 * 1_024,
});

export type PtyCommandTextSinkFailureCode =
  | 'sink_overloaded'
  | 'projection_failed'
  | 'writer_open_failed'
  | 'writer_append_failed'
  | 'writer_finalize_failed';

export type PtyCommandTextBlobSettlement =
  | { readonly status: 'not_created'; readonly reason: 'source_not_started' | 'empty' }
  | {
      readonly status: 'published';
      readonly completeness: 'complete' | 'incomplete';
      readonly blob: ToolOutputTextBlobSaveResult;
      readonly persistedCharacters: number;
      readonly persistedLines: number;
    }
  | { readonly status: 'unavailable'; readonly failureCode: PtyCommandTextSinkFailureCode };

export type PtyCommandProjectionSettlement =
  | {
      readonly status: 'complete' | 'incomplete';
      readonly screen: PtyTerminalScreenProjection;
      readonly agentPreview: PtyCommandAgentTextProjection;
      readonly stableText: string;
    }
  | { readonly status: 'failed' };

export interface PtyCommandTextSettlement {
  readonly sourceCompletion: 'not_started' | 'complete' | 'interrupted';
  readonly projection: PtyCommandProjectionSettlement;
  readonly blob: PtyCommandTextBlobSettlement;
  readonly cleanup: 'not_required' | 'complete' | 'pending' | 'failed';
}

export interface PtyCommandTextSinkInput {
  readonly projection: PtyScreenProjectionOptions;
  readonly observation: PtyCommandOutputObservationController;
  readonly openWriter: () => Promise<ToolOutputTextBlobWriter>;
  readonly limits?: PtyCommandTextSinkLimits;
}

export interface PtyCommandTextSink {
  /** 调用方必须先把 transcript 交给 raw artifact；本方法只同步复制并有界准入。 */
  accept(bytes: Uint8Array): void;
  /** resize 只在 matching runner result 接受后进入，与 transcript 共用顺序队列。 */
  acceptResize(columns: number, rows: number): void;
  settle(input: {
    readonly sourceCompletion: 'complete' | 'interrupted';
  }): Promise<PtyCommandTextSettlement>;
  settleBeforeSourceStart(): Promise<PtyCommandTextSettlement>;
}
