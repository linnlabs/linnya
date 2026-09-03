import type {
  CommandOutputTextEncoding,
  CommandPipeOutputChannel,
} from '@app/schemas/commands';

import type {
  PipeCommandAgentTextProjection,
} from '../../../../../../domains/commands/definitions/commandOutputProjection';
import type {
  CommandProcessOutputObservationPort,
} from '../../../../../../domains/commands/definitions/processOutputObservation';
import type {
  CommandOutputLogicalLineLimits,
  CommandTextProjectionLimits,
  PipeCommandOutputObservationController,
  PipeCommandTextProjectionSnapshot,
  PipeCommandTextStreamProjectionFacts,
} from '../../../../../../infra/adapters/command-runtime/output';
import type {
  ToolOutputTextBlobSaveResult,
  ToolOutputTextBlobWriter,
} from '../../../../../../tools/tool_output';

export interface PipeCommandTextSinkLimits {
  readonly maxPendingEvents: number;
  /** JavaScript UTF-16 单位；2 Mi units 对应最多约 4 MiB UTF-16 正文。 */
  readonly maxPendingCharacters: number;
}

export const DEFAULT_PIPE_COMMAND_TEXT_SINK_LIMITS: PipeCommandTextSinkLimits = Object.freeze({
  maxPendingEvents: 1_024,
  maxPendingCharacters: 2 * 1_024 * 1_024,
});

export type PipeCommandTextSinkFailureCode =
  | 'sink_overloaded'
  | 'writer_open_failed'
  | 'writer_append_failed'
  | 'writer_finalize_failed'
  | 'projection_failed';

export type PipeCommandTextBlobSettlement =
  | {
      readonly status: 'not_created';
      readonly reason: 'source_not_started' | 'empty';
    }
  | {
      readonly status: 'published';
      readonly completeness: 'complete' | 'incomplete';
      readonly blob: ToolOutputTextBlobSaveResult;
      readonly persistedCharacters: number;
      readonly persistedLines: number;
    }
  | {
      readonly status: 'unavailable';
      readonly failureCode: PipeCommandTextSinkFailureCode;
    };

export interface PipeCommandTextStreamSettlement {
  readonly sourceCompletion: 'not_started' | 'complete' | 'interrupted';
  readonly projection:
    | {
        readonly status: 'complete';
        readonly facts: PipeCommandTextStreamProjectionFacts;
      }
    | { readonly status: 'failed' };
  readonly blob: PipeCommandTextBlobSettlement;
  readonly cleanup: 'not_required' | 'complete' | 'pending' | 'failed';
}

export interface PipeCommandTextSettlement {
  readonly agentPreview: PipeCommandAgentTextProjection;
  readonly streams: Readonly<
    Record<CommandPipeOutputChannel, PipeCommandTextStreamSettlement>
  >;
}

export type OpenPipeCommandTextWriter = (
  channel: CommandPipeOutputChannel,
) => Promise<ToolOutputTextBlobWriter>;

export interface PipeCommandTextSinkInput {
  readonly encoding: CommandOutputTextEncoding;
  /** runtime 在 prepare 阶段建立的同一个观察窗口；sink 只负责写入和关闭。 */
  readonly observation: PipeCommandOutputObservationController;
  readonly currentLogicalLineLimits: CommandOutputLogicalLineLimits;
  readonly agentTextProjectionLimits: CommandTextProjectionLimits;
  readonly openWriter: OpenPipeCommandTextWriter;
  readonly limits?: PipeCommandTextSinkLimits;
}

export interface PipeCommandTextSink {
  readonly observation: CommandProcessOutputObservationPort;
  /** 调用方必须先把同一 byte 交给 raw artifact；这里同步完成文本投影与有界准入。 */
  accept(channel: CommandPipeOutputChannel, bytes: Uint8Array): void;
  snapshot(): PipeCommandTextProjectionSnapshot;
  settle(input: {
    readonly stdoutCompletion: 'complete' | 'interrupted';
    readonly stderrCompletion: 'complete' | 'interrupted';
  }): Promise<PipeCommandTextSettlement>;
  settleBeforeSourceStart(): Promise<PipeCommandTextSettlement>;
}
