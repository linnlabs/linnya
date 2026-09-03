import type {
  CommandOutputTextEncoding,
  CommandPipeOutputChannel,
} from '@app/schemas/commands';

import type {
  CommandOutputCurrentLogicalLineSnapshot,
  PipeCommandAgentTextProjection,
} from '../../../../../domains/commands/definitions/commandOutputProjection';
import { decodeCommandOutputStreams } from '../decodeCommandOutputStreams';
import type { CommandOutputLogicalLineLimits } from '../definitions/commandOutputLogicalLineLimits';
import type { CommandTextProjectionLimits } from '../definitions/commandTextProjectionLimits';
import {
  createBoundedPipeCommandTextProjection,
  type BoundedPipeCommandTextProjection,
} from '../functions/createBoundedPipeCommandTextProjection';
import {
  createStableCommandOutputLogicalLineStream,
  type StableCommandOutputLogicalLineStream,
  type StableCommandOutputTextDelta,
} from '../functions/createStableCommandOutputLogicalLineStream';
import {
  createStreamingControlSequenceParser,
  type StreamingControlSequenceParser,
} from '../functions/createStreamingControlSequenceParser';

export interface PipeCommandTextProjectionSessionOptions {
  readonly encoding: CommandOutputTextEncoding;
  readonly currentLogicalLineLimits: CommandOutputLogicalLineLimits;
  readonly agentTextProjectionLimits: CommandTextProjectionLimits;
}

export interface PipeCommandTextStreamProjectionFacts {
  readonly incompleteControlSequenceOmitted: boolean;
  readonly logicalLinesWithOmissions: number;
  readonly logicalLineOmittedCharacters: number;
}

export interface PipeCommandTextProjectionSnapshot {
  /** 只含后续 CR 无法撤回的正文，可以安全用于 initial wait 和 process poll。 */
  readonly stablePreview: PipeCommandAgentTextProjection;
  /** 可被后续 CR 覆盖的临时帧只能实时查看，不能持久化为 append-only 正文。 */
  readonly currentLogicalLines: Readonly<
    Record<CommandPipeOutputChannel, CommandOutputCurrentLogicalLineSnapshot>
  >;
}

export interface PipeCommandTextProjectionFinalization {
  /** EOF 新提交的正文；外层可把它接到最后一次 write 返回值之后。 */
  readonly trailingStableText: Readonly<Record<CommandPipeOutputChannel, string>>;
  readonly agentPreview: PipeCommandAgentTextProjection;
  readonly streams: Readonly<
    Record<CommandPipeOutputChannel, PipeCommandTextStreamProjectionFacts>
  >;
}

export interface PipeCommandTextProjectionSession {
  /** raw artifact 必须在外层先接纳同一 byte；本 session 只生成普通纯文本投影。 */
  write(
    channel: CommandPipeOutputChannel,
    bytes: Uint8Array,
  ): StableCommandOutputTextDelta;
  /** 快照不终结 session；initial wait/process poll 后仍可继续 write。 */
  snapshot(): PipeCommandTextProjectionSnapshot;
  /** runner 确认双 pipe 均已收口后调用；重复调用返回同一结果。 */
  finalize(): PipeCommandTextProjectionFinalization;
}

interface MutableProjectionStream {
  readonly parser: StreamingControlSequenceParser;
  readonly logicalLine: StableCommandOutputLogicalLineStream;
  logicalLinesWithOmissions: number;
  logicalLineOmittedCharacters: number;
}

interface ProjectionStreamFinalization {
  readonly trailingStableText: string;
  readonly facts: PipeCommandTextStreamProjectionFacts;
}

function createProjectionStream(
  limits: CommandOutputLogicalLineLimits,
): MutableProjectionStream {
  return {
    parser: createStreamingControlSequenceParser(),
    logicalLine: createStableCommandOutputLogicalLineStream(limits),
    logicalLinesWithOmissions: 0,
    logicalLineOmittedCharacters: 0,
  };
}

function recordStableDelta(
  channel: CommandPipeOutputChannel,
  stream: MutableProjectionStream,
  boundedProjection: BoundedPipeCommandTextProjection,
  delta: StableCommandOutputTextDelta,
): void {
  if (delta.stableText.length > 0) boundedProjection.append(channel, delta.stableText);
  stream.logicalLinesWithOmissions += delta.committedLinesWithOmissions;
  stream.logicalLineOmittedCharacters += delta.committedOmittedCharacters;
}

/**
 * 该 session 只固定 decoder -> parser -> logical-line -> bounded preview 的顺序。
 * runner 的真实协议只在双 pipe 收口后产生终态，因此这里故意不暴露单流 finalize；
 * 原始 byte、磁盘 sink、runner 和进程终态仍由外层 owner 负责，避免形成平行执行体系。
 */
export function createPipeCommandTextProjectionSession(
  options: PipeCommandTextProjectionSessionOptions,
): PipeCommandTextProjectionSession {
  const decoders = decodeCommandOutputStreams(options.encoding);
  const boundedProjection = createBoundedPipeCommandTextProjection(
    options.agentTextProjectionLimits,
  );
  const streams: Record<CommandPipeOutputChannel, MutableProjectionStream> = {
    stdout: createProjectionStream(options.currentLogicalLineLimits),
    stderr: createProjectionStream(options.currentLogicalLineLimits),
  };
  let finalization: PipeCommandTextProjectionFinalization | undefined;

  function acceptSanitizedText(
    channel: CommandPipeOutputChannel,
    sanitizedText: string,
  ): StableCommandOutputTextDelta {
    const stream = streams[channel];
    const delta = stream.logicalLine.write(sanitizedText);
    recordStableDelta(channel, stream, boundedProjection, delta);
    return delta;
  }

  function finalizeProjectionStream(
    channel: CommandPipeOutputChannel,
  ): ProjectionStreamFinalization {
    const stream = streams[channel];

    // decoder 的 EOF 残片仍可能产生替换字符，必须经过同一 parser 和逻辑行再收口。
    const decodedTail = decoders.finalize(channel);
    const decoderTailDelta = acceptSanitizedText(
      channel,
      stream.parser.write(decodedTail),
    );
    const parserFinalization = stream.parser.finalize();
    const logicalLineFinalization = stream.logicalLine.finalize();
    recordStableDelta(channel, stream, boundedProjection, logicalLineFinalization);

    return Object.freeze({
      trailingStableText:
        decoderTailDelta.stableText + logicalLineFinalization.stableText,
      facts: Object.freeze({
        incompleteControlSequenceOmitted:
          parserFinalization.incompleteSequenceOmitted,
        logicalLinesWithOmissions: stream.logicalLinesWithOmissions,
        logicalLineOmittedCharacters: stream.logicalLineOmittedCharacters,
      }),
    });
  }

  const session: PipeCommandTextProjectionSession = {
    write(channel, bytes) {
      if (finalization) {
        throw new Error('cannot write command output after text projection finalization');
      }
      const stream = streams[channel];
      const decodedText = decoders.write(channel, bytes);
      return acceptSanitizedText(channel, stream.parser.write(decodedText));
    },
    snapshot() {
      return Object.freeze({
        stablePreview: boundedProjection.snapshot(),
        currentLogicalLines: Object.freeze({
          stdout: streams.stdout.logicalLine.snapshotCurrentLine(),
          stderr: streams.stderr.logicalLine.snapshotCurrentLine(),
        }),
      });
    },
    finalize() {
      if (finalization) return finalization;
      const stdout = finalizeProjectionStream('stdout');
      const stderr = finalizeProjectionStream('stderr');
      finalization = Object.freeze({
        trailingStableText: Object.freeze({
          stdout: stdout.trailingStableText,
          stderr: stderr.trailingStableText,
        }),
        agentPreview: boundedProjection.finalize(),
        streams: Object.freeze({
          stdout: stdout.facts,
          stderr: stderr.facts,
        }),
      });
      return finalization;
    },
  };

  return Object.freeze(session);
}
