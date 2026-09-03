import type { CommandPipeOutputChannel } from '@app/schemas/commands';

import {
  createPipeCommandTextProjectionSession,
  type PipeCommandTextProjectionSession,
  type PipeCommandTextProjectionFinalization,
  type PipeCommandTextProjectionSessionOptions,
  type PipeCommandTextProjectionSnapshot,
  type PipeCommandTextStreamProjectionFacts,
} from '../../../../../../infra/adapters/command-runtime/output';
import type {
  ToolOutputTextBlobSaveResult,
  ToolOutputTextBlobWriter,
} from '../../../../../../tools/tool_output';
import {
  DEFAULT_PIPE_COMMAND_TEXT_SINK_LIMITS,
  type PipeCommandTextBlobSettlement,
  type PipeCommandTextSettlement,
  type PipeCommandTextSink,
  type PipeCommandTextSinkFailureCode,
  type PipeCommandTextSinkInput,
  type PipeCommandTextSinkLimits,
} from '../definitions/pipeCommandTextSink';

interface PendingStableText {
  readonly channel: CommandPipeOutputChannel;
  readonly text: string;
}

interface MutableTextStreamPersistence {
  writer?: ToolOutputTextBlobWriter;
  persistedCharacters: number;
  persistedNewlines: number;
  droppedCharacters: number;
  overloaded: boolean;
  failureCode?: Exclude<PipeCommandTextSinkFailureCode, 'sink_overloaded' | 'projection_failed'>;
  published?: ToolOutputTextBlobSaveResult;
  cleanup: 'not_required' | 'complete' | 'pending' | 'failed';
}

interface HostTextProjectionFinalization {
  readonly trailingStableText: Readonly<Record<CommandPipeOutputChannel, string>>;
  readonly agentPreview: PipeCommandTextProjectionFinalization['agentPreview'];
  readonly streams: Readonly<Record<
    CommandPipeOutputChannel,
    | { readonly status: 'complete'; readonly facts: PipeCommandTextStreamProjectionFacts }
    | { readonly status: 'failed' }
  >>;
}

export interface PipeCommandTextSinkDependencies {
  readonly createProjectionSession: (
    options: PipeCommandTextProjectionSessionOptions,
  ) => PipeCommandTextProjectionSession;
}

const DEFAULT_DEPENDENCIES: PipeCommandTextSinkDependencies = Object.freeze({
  createProjectionSession: createPipeCommandTextProjectionSession,
});

function validateLimits(raw: PipeCommandTextSinkLimits): PipeCommandTextSinkLimits {
  for (const [name, value] of Object.entries(raw)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`pipe command text sink ${name} must be a positive safe integer`);
    }
  }
  return Object.freeze({
    maxPendingEvents: raw.maxPendingEvents,
    maxPendingCharacters: raw.maxPendingCharacters,
  });
}

function createStream(): MutableTextStreamPersistence {
  return {
    persistedCharacters: 0,
    persistedNewlines: 0,
    droppedCharacters: 0,
    overloaded: false,
    cleanup: 'not_required',
  };
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) count += 1;
  }
  return count;
}

/**
 * 系统 pipe 回调只能调用同步 accept。ToolOutputStore 的 await 背压由这里的一条共享有界
 * 队列吸收；stdout/stderr 仍各自拥有 writer，避免把回调到达顺序伪装成绝对输出顺序。
 */
export function createPipeCommandTextSink(
  input: PipeCommandTextSinkInput,
  dependencies: PipeCommandTextSinkDependencies = DEFAULT_DEPENDENCIES,
): PipeCommandTextSink {
  const limits = validateLimits(input.limits ?? DEFAULT_PIPE_COMMAND_TEXT_SINK_LIMITS);
  const projection = dependencies.createProjectionSession({
    encoding: input.encoding,
    currentLogicalLineLimits: input.currentLogicalLineLimits,
    agentTextProjectionLimits: input.agentTextProjectionLimits,
  });
  const observation = input.observation;
  const streams: Record<CommandPipeOutputChannel, MutableTextStreamPersistence> = {
    stdout: createStream(),
    stderr: createStream(),
  };
  const pending: PendingStableText[] = [];
  let pendingEvents = 0;
  let pendingCharacters = 0;
  let pumpRunning = false;
  let settlementStarted = false;
  let projectionFailed = false;
  let lastSafeSnapshot: PipeCommandTextProjectionSnapshot = projection.snapshot();
  let settlementPromise: Promise<PipeCommandTextSettlement> | undefined;
  let idleWaiters: Array<() => void> = [];

  function wakeIdleWaiters(): void {
    if (pumpRunning || pending.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function waitForIdle(): Promise<void> {
    if (!pumpRunning && pending.length === 0) return Promise.resolve();
    return new Promise(resolve => idleWaiters.push(resolve));
  }

  function dropQueuedChannel(channel: CommandPipeOutputChannel): void {
    let writeIndex = 0;
    for (const item of pending) {
      if (item.channel === channel) {
        pendingEvents -= 1;
        pendingCharacters -= item.text.length;
        streams[channel].droppedCharacters += item.text.length;
        continue;
      }
      pending[writeIndex] = item;
      writeIndex += 1;
    }
    pending.length = writeIndex;
  }

  async function abortWriter(stream: MutableTextStreamPersistence): Promise<void> {
    if (!stream.writer) return;
    stream.cleanup = 'pending';
    try {
      await stream.writer.abort();
      stream.cleanup = 'complete';
    } catch {
      stream.cleanup = 'failed';
    }
  }

  function failStream(
    channel: CommandPipeOutputChannel,
    code: MutableTextStreamPersistence['failureCode'],
    currentText?: string,
  ): void {
    const stream = streams[channel];
    stream.failureCode ??= code;
    if (currentText) stream.droppedCharacters += currentText.length;
    dropQueuedChannel(channel);
  }

  async function requireWriter(channel: CommandPipeOutputChannel): Promise<ToolOutputTextBlobWriter> {
    const stream = streams[channel];
    if (stream.writer) return stream.writer;
    try {
      const writer = await input.openWriter(channel);
      stream.writer = writer;
      return writer;
    } catch (error: unknown) {
      failStream(channel, 'writer_open_failed');
      throw error;
    }
  }

  async function pump(): Promise<void> {
    if (pumpRunning) return;
    pumpRunning = true;
    try {
      while (pending.length > 0) {
        const item = pending.shift();
        if (!item) break;
        try {
          const stream = streams[item.channel];
          if (stream.failureCode) {
            stream.droppedCharacters += item.text.length;
            continue;
          }
          try {
            const writer = await requireWriter(item.channel);
            await writer.append(item.text);
            stream.persistedCharacters += item.text.length;
            stream.persistedNewlines += countNewlines(item.text);
          } catch {
            failStream(item.channel, stream.failureCode ?? 'writer_append_failed', item.text);
          }
        } finally {
          pendingEvents -= 1;
          pendingCharacters -= item.text.length;
        }
      }
    } finally {
      pumpRunning = false;
      wakeIdleWaiters();
      if (pending.length > 0) void pump();
    }
  }

  function offerStableText(channel: CommandPipeOutputChannel, text: string): void {
    if (text.length === 0) return;
    const stream = streams[channel];
    if (
      stream.overloaded
      || stream.failureCode
    ) {
      stream.droppedCharacters += text.length;
      return;
    }
    if (
      pendingEvents >= limits.maxPendingEvents
      || pendingCharacters + text.length > limits.maxPendingCharacters
    ) {
      // 已经接纳的前缀继续落盘；从本次 delta 起停止新准入，避免丢失事实后反复重试。
      stream.overloaded = true;
      stream.droppedCharacters += text.length;
      return;
    }
    pending.push({ channel, text });
    pendingEvents += 1;
    pendingCharacters += text.length;
    void pump();
  }

  async function finalizeStream(
    channel: CommandPipeOutputChannel,
  ): Promise<void> {
    const stream = streams[channel];
    if (stream.failureCode === 'writer_append_failed' && stream.writer) {
      try {
        const prefix = await stream.writer.finalizeCommittedPrefix();
        if (prefix.status === 'published') {
          stream.published = prefix.blob;
          stream.persistedCharacters = prefix.persistedCharacters;
          stream.persistedNewlines = prefix.persistedLines - 1;
          stream.cleanup = prefix.blob.stagingCleanup === 'complete' ? 'complete' : 'pending';
          return;
        }
      } catch {
        // 原始 append 失败仍是首要存储事实；前缀发布失败只决定没有可读取引用。
      }
      await abortWriter(stream);
      return;
    }
    if (stream.failureCode || !stream.writer) {
      await abortWriter(stream);
      return;
    }
    try {
      stream.published = await stream.writer.finalize();
      stream.cleanup = stream.published.stagingCleanup === 'complete' ? 'complete' : 'pending';
    } catch {
      stream.failureCode = 'writer_finalize_failed';
      await abortWriter(stream);
    }
  }

  function buildBlobSettlement(
    channel: CommandPipeOutputChannel,
    sourceCompletion: 'not_started' | 'complete' | 'interrupted',
    projectionSettlement: HostTextProjectionFinalization['streams'][CommandPipeOutputChannel],
  ): PipeCommandTextBlobSettlement {
    const stream = streams[channel];
    if (stream.published) {
      const incomplete = sourceCompletion !== 'complete'
        || projectionSettlement.status === 'failed'
        || projectionSettlement.facts.incompleteControlSequenceOmitted
        || projectionSettlement.facts.logicalLinesWithOmissions > 0
        || stream.droppedCharacters > 0;
      return Object.freeze({
        status: 'published',
        completeness: incomplete ? 'incomplete' : 'complete',
        blob: stream.published,
        persistedCharacters: stream.persistedCharacters,
        persistedLines: stream.persistedNewlines + 1,
      });
    }
    if (stream.failureCode) {
      return Object.freeze({ status: 'unavailable', failureCode: stream.failureCode });
    }
    if (projectionSettlement.status === 'failed') {
      return Object.freeze({ status: 'unavailable', failureCode: 'projection_failed' });
    }
    if (stream.droppedCharacters > 0) {
      return Object.freeze({ status: 'unavailable', failureCode: 'sink_overloaded' });
    }
    return Object.freeze({
      status: 'not_created',
      reason: sourceCompletion === 'not_started' ? 'source_not_started' : 'empty',
    });
  }

  function buildSettlement(
    finalization: HostTextProjectionFinalization,
    source: Readonly<Record<CommandPipeOutputChannel, 'not_started' | 'complete' | 'interrupted'>>,
  ): PipeCommandTextSettlement {
    return Object.freeze({
      agentPreview: finalization.agentPreview,
      streams: Object.freeze({
        stdout: Object.freeze({
          sourceCompletion: source.stdout,
          projection: finalization.streams.stdout,
          blob: buildBlobSettlement('stdout', source.stdout, finalization.streams.stdout),
          cleanup: streams.stdout.cleanup,
        }),
        stderr: Object.freeze({
          sourceCompletion: source.stderr,
          projection: finalization.streams.stderr,
          blob: buildBlobSettlement('stderr', source.stderr, finalization.streams.stderr),
          cleanup: streams.stderr.cleanup,
        }),
      }),
    });
  }

  function beginSettlement(
    source: Readonly<Record<CommandPipeOutputChannel, 'not_started' | 'complete' | 'interrupted'>>,
  ): Promise<PipeCommandTextSettlement> {
    if (settlementPromise) return settlementPromise;
    settlementStarted = true;
    let finalization: HostTextProjectionFinalization;
    if (projectionFailed) {
      observation.markProjectionFailed();
      finalization = Object.freeze({
        trailingStableText: Object.freeze({ stdout: '', stderr: '' }),
        agentPreview: lastSafeSnapshot.stablePreview,
        streams: Object.freeze({
          stdout: Object.freeze({ status: 'failed' as const }),
          stderr: Object.freeze({ status: 'failed' as const }),
        }),
      });
    } else {
      try {
        const completed = projection.finalize();
        finalization = Object.freeze({
          trailingStableText: completed.trailingStableText,
          agentPreview: completed.agentPreview,
          streams: Object.freeze({
            stdout: Object.freeze({ status: 'complete' as const, facts: completed.streams.stdout }),
            stderr: Object.freeze({ status: 'complete' as const, facts: completed.streams.stderr }),
          }),
        });
      } catch {
        projectionFailed = true;
        observation.markProjectionFailed();
        finalization = Object.freeze({
          trailingStableText: Object.freeze({ stdout: '', stderr: '' }),
          agentPreview: lastSafeSnapshot.stablePreview,
          streams: Object.freeze({
            stdout: Object.freeze({ status: 'failed' as const }),
            stderr: Object.freeze({ status: 'failed' as const }),
          }),
        });
      }
    }
    offerStableText('stdout', finalization.trailingStableText.stdout);
    offerStableText('stderr', finalization.trailingStableText.stderr);
    observation.close({ trailingStableText: finalization.trailingStableText });

    settlementPromise = (async () => {
      await waitForIdle();
      await Promise.all([finalizeStream('stdout'), finalizeStream('stderr')]);
      return buildSettlement(finalization, source);
    })();
    return settlementPromise;
  }

  return Object.freeze({
    observation,
    accept(channel, bytes) {
      if (settlementStarted) throw new Error('cannot accept command text after settlement started');
      if (projectionFailed) return;
      try {
        const delta = projection.write(channel, bytes);
        const snapshot = projection.snapshot();
        observation.accept({
          channel,
          stableText: delta.stableText,
          currentLogicalLines: snapshot.currentLogicalLines,
        });
        offerStableText(channel, delta.stableText);
        lastSafeSnapshot = snapshot;
      } catch {
        // 文本只是 raw byte 的派生投影；投影 bug 必须熔断文本层，不能停止 pipe drain 或改命令终因。
        projectionFailed = true;
        observation.markProjectionFailed();
      }
    },
    snapshot() {
      if (projectionFailed) return lastSafeSnapshot;
      try {
        lastSafeSnapshot = projection.snapshot();
      } catch {
        projectionFailed = true;
      }
      return lastSafeSnapshot;
    },
    settle(source) {
      return beginSettlement({
        stdout: source.stdoutCompletion,
        stderr: source.stderrCompletion,
      });
    },
    settleBeforeSourceStart() {
      return beginSettlement({ stdout: 'not_started', stderr: 'not_started' });
    },
  } satisfies PipeCommandTextSink);
}
