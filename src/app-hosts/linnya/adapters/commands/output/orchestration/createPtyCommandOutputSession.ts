import {
  hasSameCommandExecutionIdentity,
} from '@app/schemas/commands';
import type {
  CommandOutputArtifactOpenResult,
  CommandOutputArtifactWriter,
} from '../../../../../../domains/commands';
import {
  COMMAND_OUTPUT_ARTIFACT_RETENTION_MS,
} from '../definitions/pipeCommandOutputSession';
import type {
  CommandRunnerPtyOutputEvent,
  CommandRunnerStartedEvent,
  PtyCommandOutputAcceptResult,
  PtyCommandOutputArtifactSettlement,
  PtyCommandOutputProtocolFailure,
  PtyCommandOutputSession,
  PtyCommandOutputSessionInput,
  PtyCommandOutputSettlement,
} from '../definitions/ptyCommandOutputSession';
import {
  createCommandPrelaunchFailureTerminal,
  createCommandPrelaunchTerminationTerminal,
  createCommandRuntimeLostTerminal,
} from '../functions/createPipeCommandRuntimeTerminal';
import { validatePtyCommandRunnerTerminal } from '../functions/validatePtyCommandRunnerTerminal';
import { createPtyCommandTextSink } from './createPtyCommandTextSink';

/**
 * PTY 只拥有一条 terminal transcript。raw writer 先取得 byte 所有权，headless parser 再
 * 有界准入；任何派生层失败都不能停止 runner drain 或改写真实进程终因。
 */
export async function createPtyCommandOutputSession(
  input: PtyCommandOutputSessionInput,
): Promise<PtyCommandOutputSession> {
  const retentionMs = input.retentionMs ?? COMMAND_OUTPUT_ARTIFACT_RETENTION_MS;
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
    throw new Error('command output artifact retention must be a positive safe integer');
  }
  const textSink = createPtyCommandTextSink(input.text);
  let opened: CommandOutputArtifactOpenResult;
  try {
    opened = await input.artifactPort.open({ owner: input.owner, mode: 'pty' });
  } catch (error: unknown) {
    // headless parser 已创建；artifact open 异常时也必须走唯一 settlement 释放它。
    await textSink.settleBeforeSourceStart();
    throw error;
  }
  const writer: CommandOutputArtifactWriter | undefined = opened.status === 'opened'
    ? opened.writer
    : undefined;
  const unavailableArtifact: PtyCommandOutputArtifactSettlement | undefined =
    opened.status === 'unavailable'
      ? { status: 'unavailable', failure: opened.failure }
      : undefined;
  let nextSequence = 0;
  let receivedBytes = 0;
  let sourceStarted = false;
  let settled = false;
  let protocolFailure: PtyCommandOutputProtocolFailure | undefined;
  let settlementPromise: Promise<PtyCommandOutputSettlement> | undefined;

  function failProtocol(
    failure: PtyCommandOutputProtocolFailure,
  ): PtyCommandOutputAcceptResult {
    protocolFailure ??= failure;
    return { status: 'protocol_failure', failure: protocolFailure };
  }

  function acceptIdentity(
    event: CommandRunnerStartedEvent | CommandRunnerPtyOutputEvent,
  ): PtyCommandOutputAcceptResult | undefined {
    if (settled) return { status: 'ignored', reason: 'settled' };
    if (protocolFailure) return { status: 'ignored', reason: 'protocol_failed' };
    if (!hasSameCommandExecutionIdentity(input.owner.identity, event.identity)) {
      return failProtocol({ code: 'identity_mismatch' });
    }
    return undefined;
  }

  async function finalizeArtifact(inputFinalize: {
    readonly sealedAtMs: number;
    readonly sourceCompletion: 'complete' | 'interrupted';
  }): Promise<PtyCommandOutputArtifactSettlement> {
    if (!writer) {
      if (!unavailableArtifact) throw new Error('PTY artifact open result lost its settlement');
      return unavailableArtifact;
    }
    return writer.finalize({
      sealedAtMs: inputFinalize.sealedAtMs,
      retentionUntilMs: inputFinalize.sealedAtMs + retentionMs,
      source: { mode: 'pty', terminal: inputFinalize.sourceCompletion },
    });
  }

  async function discardArtifact(): Promise<PtyCommandOutputArtifactSettlement> {
    if (!writer) {
      if (!unavailableArtifact) throw new Error('PTY artifact open result lost its settlement');
      return unavailableArtifact;
    }
    return writer.discardBeforeSourceStart();
  }

  function beginSettlement(
    work: () => Promise<PtyCommandOutputSettlement>,
  ): Promise<PtyCommandOutputSettlement> {
    if (settlementPromise) return settlementPromise;
    settled = true;
    settlementPromise = work();
    return settlementPromise;
  }

  const session: PtyCommandOutputSession = {
    owner: input.owner,
    observation: input.text.observation,
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
      if (event.sequence !== nextSequence) return failProtocol({ code: 'sequence_mismatch' });
      nextSequence += 1;
      receivedBytes += event.bytes.byteLength;
      writer?.append({
        mode: 'pty',
        channel: 'terminal',
        sequence: event.sequence,
        bytes: event.bytes,
      });
      textSink.accept(event.bytes);
      return { status: 'accepted' };
    },
    acceptResize(size) {
      if (settled || protocolFailure || !sourceStarted) return;
      textSink.acceptResize(size.columns, size.rows);
    },
    settleRunnerTerminal({ event, sealedAtMs }) {
      return beginSettlement(async () => {
        const validation = validatePtyCommandRunnerTerminal({
          expectedIdentity: input.owner.identity,
          sourceStarted,
          receipt: { nextSequence, receivedBytes },
          event,
        });
        if (validation.status === 'protocol_failure') protocolFailure ??= validation.failure;

        if (
          !sourceStarted
          && !protocolFailure
          && event.terminal.process_exit.status === 'not_started'
        ) {
          const text = await textSink.settleBeforeSourceStart();
          return { terminal: event.terminal, artifact: await discardArtifact(), text };
        }

        const source = event.output_sources?.mode === 'pty'
          ? event.output_sources.terminal
          : undefined;
        const sourceCompletion = protocolFailure
          ? 'interrupted' as const
          : source?.source_completion ?? 'interrupted';
        const [artifact, text] = await Promise.all([
          finalizeArtifact({ sealedAtMs, sourceCompletion }),
          textSink.settle({ sourceCompletion }),
        ]);
        if (!protocolFailure) return { terminal: event.terminal, artifact, text };
        const candidate = hasSameCommandExecutionIdentity(
          input.owner.identity,
          event.terminal.identity,
        ) ? event.terminal : undefined;
        return {
          terminal: createCommandRuntimeLostTerminal({
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
            sourceCompletion: 'interrupted',
          }),
          textSink.settle({ sourceCompletion: 'interrupted' }),
        ]);
        return {
          terminal: createCommandRuntimeLostTerminal({
            identity: input.owner.identity,
            settledAtMs: runtimeLoss.settledAtMs,
            candidate: runtimeLoss.candidate,
            resourceRelease: runtimeLoss.resourceRelease,
          }),
          artifact,
          text,
          ...(protocolFailure ? { protocolFailure } : {}),
        };
      });
    },
    settleBeforeSourceStart(settlement) {
      if (sourceStarted || nextSequence !== 0 || protocolFailure) {
        throw new Error('cannot settle a started or uncertain PTY command as prelaunch failure');
      }
      return beginSettlement(async () => {
        const [artifact, text] = await Promise.all([
          discardArtifact(),
          textSink.settleBeforeSourceStart(),
        ]);
        return {
          terminal: createCommandPrelaunchFailureTerminal({
            identity: input.owner.identity,
            settledAtMs: settlement.settledAtMs,
            failureCode: settlement.failureCode,
          }),
          artifact,
          text,
        };
      });
    },
    settleBeforeSourceStartTermination(settlement) {
      if (sourceStarted || nextSequence !== 0 || protocolFailure) {
        throw new Error('cannot settle a started or uncertain PTY command as prelaunch termination');
      }
      return beginSettlement(async () => {
        const [artifact, text] = await Promise.all([
          discardArtifact(),
          textSink.settleBeforeSourceStart(),
        ]);
        return {
          terminal: createCommandPrelaunchTerminationTerminal({
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
