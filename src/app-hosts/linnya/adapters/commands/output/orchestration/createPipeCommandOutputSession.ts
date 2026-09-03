import {
  hasSameCommandExecutionIdentity,
  type CommandPipeOutputChannel,
  type CommandRunnerEventV1,
} from '@app/schemas/commands';
import type {
  CommandOutputArtifactOpenResult,
  CommandOutputArtifactWriter,
} from '../../../../../../domains/commands';

import {
  COMMAND_OUTPUT_ARTIFACT_RETENTION_MS,
  type CommandRunnerOutputEventV1,
  type CommandRunnerStartedEventV1,
  type PipeCommandOutputAcceptResult,
  type PipeCommandOutputArtifactSettlement,
  type PipeCommandOutputSessionInput,
  type PipeCommandOutputProtocolFailure,
  type PipeCommandOutputSession,
  type PipeCommandOutputSettlement,
} from '../definitions/pipeCommandOutputSession';
import { createPipeCommandTextSink } from './createPipeCommandTextSink';
import {
  createPipeCommandPrelaunchFailureTerminal,
  createPipeCommandPrelaunchTerminationTerminal,
  createPipeCommandRuntimeLostTerminal,
} from '../functions/createPipeCommandRuntimeTerminal';
import {
  validatePipeCommandRunnerTerminal,
  type PipeCommandOutputReceipt,
} from '../functions/validatePipeCommandRunnerTerminal';

interface MutablePipeCommandOutputReceipt {
  nextSequence: number;
  receivedBytes: number;
}

function createReceipt(): MutablePipeCommandOutputReceipt {
  return { nextSequence: 0, receivedBytes: 0 };
}

function readEventIdentity(event: Exclude<CommandRunnerEventV1, {
  readonly kind: 'command_runner_terminal';
}>): CommandRunnerStartedEventV1['identity'] {
  return event.identity;
}

/**
 * 这个 session 不缓存 raw 正文，只保存 sequence/byte 计数。合法 byte 先交给 raw writer，
 * 再同步进入文本投影；ToolOutputStore 的异步写入由独立有界 sink 隔离，不能堵系统 pipe。
 */
export async function createPipeCommandOutputSession(
  input: PipeCommandOutputSessionInput,
): Promise<PipeCommandOutputSession> {
  const retentionMs = input.retentionMs ?? COMMAND_OUTPUT_ARTIFACT_RETENTION_MS;
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
    throw new Error('command output artifact retention must be a positive safe integer');
  }

  // 文本层只建立内存状态，必须先完成配置校验；否则 raw writer 已打开后再失败会泄漏句柄。
  const textSink = createPipeCommandTextSink(input.text);
  let opened: CommandOutputArtifactOpenResult;
  try {
    opened = await input.artifactPort.open({
      owner: input.owner,
      mode: 'pipe',
    });
  } catch (error: unknown) {
    // observation 在 artifact 之前创建。open 失败时必须用唯一的 pre-start settlement
    // 关闭观察窗口并唤醒长期等待者，不能把 timer 留到其最大期限才自行回收。
    await textSink.settleBeforeSourceStart();
    throw error;
  }
  const writer: CommandOutputArtifactWriter | undefined = opened.status === 'opened'
    ? opened.writer
    : undefined;
  const unavailableArtifact: PipeCommandOutputArtifactSettlement | undefined =
    opened.status === 'unavailable'
      ? { status: 'unavailable', failure: opened.failure }
      : undefined;
  const stdout = createReceipt();
  const stderr = createReceipt();
  let sourceStarted = false;
  let settled = false;
  let protocolFailure: PipeCommandOutputProtocolFailure | undefined;
  let settlementPromise: Promise<PipeCommandOutputSettlement> | undefined;

  function receipt(channel: CommandPipeOutputChannel): MutablePipeCommandOutputReceipt {
    return channel === 'stdout' ? stdout : stderr;
  }

  function failProtocol(
    failure: PipeCommandOutputProtocolFailure,
  ): PipeCommandOutputAcceptResult {
    protocolFailure ??= failure;
    return { status: 'protocol_failure', failure: protocolFailure };
  }

  function acceptIdentity(
    event: CommandRunnerStartedEventV1 | CommandRunnerOutputEventV1,
  ): PipeCommandOutputAcceptResult | undefined {
    if (settled) return { status: 'ignored', reason: 'settled' };
    if (protocolFailure) return { status: 'ignored', reason: 'protocol_failed' };
    if (!hasSameCommandExecutionIdentity(
      input.owner.identity,
      readEventIdentity(event),
    )) {
      return failProtocol({ code: 'identity_mismatch' });
    }
    return undefined;
  }

  async function finalizeArtifact(inputFinalize: {
    readonly sealedAtMs: number;
    readonly stdoutCompletion: 'complete' | 'interrupted';
    readonly stderrCompletion: 'complete' | 'interrupted';
  }): Promise<PipeCommandOutputArtifactSettlement> {
    if (!writer) {
      if (!unavailableArtifact) {
        throw new Error('command output artifact open result lost its settlement');
      }
      return unavailableArtifact;
    }
    return writer.finalize({
      sealedAtMs: inputFinalize.sealedAtMs,
      retentionUntilMs: inputFinalize.sealedAtMs + retentionMs,
      source: {
        mode: 'pipe',
        stdout: inputFinalize.stdoutCompletion,
        stderr: inputFinalize.stderrCompletion,
      },
    });
  }

  async function discardArtifact(): Promise<PipeCommandOutputArtifactSettlement> {
    if (!writer) {
      if (!unavailableArtifact) {
        throw new Error('command output artifact open result lost its settlement');
      }
      return unavailableArtifact;
    }
    return writer.discardBeforeSourceStart();
  }

  function beginSettlement(
    work: () => Promise<PipeCommandOutputSettlement>,
  ): Promise<PipeCommandOutputSettlement> {
    if (settlementPromise) return settlementPromise;
    settled = true;
    settlementPromise = work();
    return settlementPromise;
  }

  const session: PipeCommandOutputSession = {
    owner: input.owner,
    observation: textSink.observation,

    acceptStarted(event) {
      const identity = acceptIdentity(event);
      if (identity) return identity;
      if (sourceStarted) return failProtocol({ code: 'duplicate_start' });
      sourceStarted = true;
      return { status: 'accepted' };
    },

    acceptOutput(event) {
      const identity = acceptIdentity(event);
      if (identity) return identity;
      if (!sourceStarted) return failProtocol({ code: 'output_before_start' });

      const channelReceipt = receipt(event.channel);
      if (event.sequence !== channelReceipt.nextSequence) {
        return failProtocol({ code: 'sequence_mismatch', channel: event.channel });
      }
      channelReceipt.nextSequence += 1;
      channelReceipt.receivedBytes += event.bytes.byteLength;
      writer?.append({
        mode: 'pipe',
        channel: event.channel,
        sequence: event.sequence,
        bytes: event.bytes,
      });
      // raw writer 必须先取得同一 byte 的所有权；文本层失败不能反向丢失原始证据。
      textSink.accept(event.channel, event.bytes);
      return { status: 'accepted' };
    },

    settleRunnerTerminal(settlement) {
      return beginSettlement(async () => {
        const { event } = settlement;
        const validation = validatePipeCommandRunnerTerminal({
          expectedIdentity: input.owner.identity,
          sourceStarted,
          stdout: stdout satisfies PipeCommandOutputReceipt,
          stderr: stderr satisfies PipeCommandOutputReceipt,
          event,
        });
        if (validation.status === 'protocol_failure') {
          protocolFailure ??= validation.failure;
        }

        if (
          !sourceStarted
          && !protocolFailure
          && event.terminal.process_exit.status === 'not_started'
        ) {
          const text = await textSink.settleBeforeSourceStart();
          return {
            terminal: event.terminal,
            artifact: await discardArtifact(),
            text,
          };
        }

        const pipeOutputSources = event.output_sources?.mode === 'pipe'
          ? event.output_sources
          : undefined;
        const stdoutCompletion = protocolFailure
          ? 'interrupted' as const
          : pipeOutputSources?.stdout.source_completion ?? 'interrupted';
        const stderrCompletion = protocolFailure
          ? 'interrupted' as const
          : pipeOutputSources?.stderr.source_completion ?? 'interrupted';
        const [artifact, text] = await Promise.all([
          finalizeArtifact({
            sealedAtMs: settlement.sealedAtMs,
            stdoutCompletion,
            stderrCompletion,
          }),
          textSink.settle({ stdoutCompletion, stderrCompletion }),
        ]);
        if (!protocolFailure) return { terminal: event.terminal, artifact, text };

        const candidate = hasSameCommandExecutionIdentity(
          input.owner.identity,
          event.terminal.identity,
        ) ? event.terminal : undefined;
        return {
          terminal: createPipeCommandRuntimeLostTerminal({
            identity: input.owner.identity,
            settledAtMs: event.terminal.settled_at_ms,
            candidate,
            resourceRelease: 'succeeded',
          }),
          artifact,
          text,
          protocolFailure,
        };
      });
    },

    settleRuntimeLoss(runtimeLoss) {
      return beginSettlement(async () => {
        const [artifact, text] = await Promise.all([
          finalizeArtifact({
            sealedAtMs: runtimeLoss.settledAtMs,
            stdoutCompletion: 'interrupted',
            stderrCompletion: 'interrupted',
          }),
          textSink.settle({
            stdoutCompletion: 'interrupted',
            stderrCompletion: 'interrupted',
          }),
        ]);
        return {
          terminal: createPipeCommandRuntimeLostTerminal({
            identity: input.owner.identity,
            settledAtMs: runtimeLoss.settledAtMs,
            resourceRelease: runtimeLoss.resourceRelease,
          }),
          artifact,
          text,
          ...(protocolFailure ? { protocolFailure } : {}),
        };
      });
    },

    async settleBeforeSourceStart(settlement) {
      if (
        sourceStarted
        || stdout.nextSequence !== 0
        || stderr.nextSequence !== 0
        || protocolFailure
      ) {
        throw new Error('cannot settle a started or uncertain command as a prelaunch failure');
      }
      return beginSettlement(async () => {
        const [artifact, text] = await Promise.all([
          discardArtifact(),
          textSink.settleBeforeSourceStart(),
        ]);
        return {
          terminal: createPipeCommandPrelaunchFailureTerminal({
            identity: input.owner.identity,
            settledAtMs: settlement.settledAtMs,
            failureCode: settlement.failureCode,
          }),
          artifact,
          text,
        };
      });
    },

    async settleBeforeSourceStartTermination(settlement) {
      if (
        sourceStarted
        || stdout.nextSequence !== 0
        || stderr.nextSequence !== 0
        || protocolFailure
      ) {
        throw new Error('cannot settle a started or uncertain command as a prelaunch termination');
      }
      return beginSettlement(async () => {
        const [artifact, text] = await Promise.all([
          discardArtifact(),
          textSink.settleBeforeSourceStart(),
        ]);
        return {
          terminal: createPipeCommandPrelaunchTerminationTerminal({
            identity: input.owner.identity,
            settledAtMs: settlement.settledAtMs,
            cause: settlement.cause,
          }),
          artifact,
          text,
        };
      });
    },
  };
  return Object.freeze(session);
}
