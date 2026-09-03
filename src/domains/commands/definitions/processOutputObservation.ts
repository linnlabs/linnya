import type {
  CommandPipeOutputChannel,
  ProcessOutputCursor,
} from '@app/schemas/commands';

import type {
  CommandOutputCurrentLogicalLineSnapshot,
  CommandOutputTextPreview,
  PtyTerminalScreenProjection,
} from './commandOutputProjection';

interface ProcessOutputObservationWindowBase {
  /** 请求游标仍在内存窗口内时为 complete；落后时明确报告省略，不能伪造连续增量。 */
  readonly coverage: 'complete' | 'omitted';
  readonly requestedCursor: ProcessOutputCursor;
  readonly availableAfterCursor: ProcessOutputCursor;
  readonly nextCursor: ProcessOutputCursor;
  readonly outputPhase: 'open' | 'closed';
  readonly textProjection: 'available' | 'failed';
}

export interface PipeProcessOutputObservationWindow
  extends ProcessOutputObservationWindowBase {
  readonly mode: 'pipe';
  readonly stdout: string;
  readonly stderr: string;
  readonly currentLogicalLines: Readonly<
    Record<CommandPipeOutputChannel, CommandOutputCurrentLogicalLineSnapshot>
  >;
}

export interface PtyProcessOutputObservationWindow
  extends ProcessOutputObservationWindowBase {
  readonly mode: 'pty';
  /** PTY 是合流终端屏幕；这里只返回本次 cursor 之后最新的稳定屏幕，不伪造 stdout。 */
  readonly terminal?: CommandOutputTextPreview;
  /** Renderer 只消费 host 已完成 ANSI 解释后的稀疏屏幕，不能从 terminal 文本重建样式。 */
  readonly screen?: PtyTerminalScreenProjection;
}

export type ProcessOutputObservationWindow =
  | PipeProcessOutputObservationWindow
  | PtyProcessOutputObservationWindow;

export type ProcessOutputObservationReadResult =
  | {
      readonly status: 'observed';
      readonly observation: ProcessOutputObservationWindow;
    }
  | { readonly status: 'invalid_cursor' };

/**
 * 同一 execution 的只读运行中观察口。它不消费输出，也不持有 PID、pipe 或落盘 writer；
 * 因此同一个 cursor 可以被多个 Agent 重试，不会互相吞掉增量。
 */
export interface CommandProcessOutputObservationPort {
  read(afterCursor: ProcessOutputCursor): ProcessOutputObservationReadResult;
  waitForChange(input: {
    readonly afterCursor: ProcessOutputCursor;
    readonly waitTimeoutMs: number;
  }): Promise<ProcessOutputObservationReadResult>;
}
