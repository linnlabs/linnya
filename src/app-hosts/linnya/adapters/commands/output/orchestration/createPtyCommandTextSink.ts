import {
  createPtyScreenProjection,
  type PtyScreenProjectionSession,
} from '../../../../../../infra/adapters/command-runtime/pty';
import type { ToolOutputTextBlobWriter } from '../../../../../../tools/tool_output';
import {
  DEFAULT_PTY_COMMAND_TEXT_SINK_LIMITS,
  type PtyCommandProjectionSettlement,
  type PtyCommandTextBlobSettlement,
  type PtyCommandTextSettlement,
  type PtyCommandTextSink,
  type PtyCommandTextSinkInput,
  type PtyCommandTextSinkLimits,
  type PtyCommandTextSinkFailureCode,
} from '../definitions/ptyCommandTextSink';

type PendingProjectionAction =
  | { readonly kind: 'transcript'; readonly bytes: Uint8Array }
  | { readonly kind: 'resize'; readonly columns: number; readonly rows: number };

export interface PtyCommandTextSinkDependencies {
  readonly createProjection: (
    options: PtyCommandTextSinkInput['projection'],
  ) => PtyScreenProjectionSession;
}

const DEFAULT_DEPENDENCIES: PtyCommandTextSinkDependencies = Object.freeze({
  createProjection: createPtyScreenProjection,
});

function validateLimits(raw: PtyCommandTextSinkLimits): PtyCommandTextSinkLimits {
  if (
    !Number.isSafeInteger(raw.maxPendingEvents)
    || raw.maxPendingEvents <= 0
    || !Number.isSafeInteger(raw.maxPendingBytes)
    || raw.maxPendingBytes <= 0
  ) {
    throw new Error('PTY command text sink limits must be positive safe integers');
  }
  return Object.freeze({ ...raw });
}

/**
 * runner callback 只复制 transcript 并做固定预算准入。真实 headless parser、屏幕快照和
 * ToolOutputStore 都在 callback 外执行；它们失败时熔断派生层，raw transcript 仍继续 drain。
 */
export function createPtyCommandTextSink(
  input: PtyCommandTextSinkInput,
  dependencies: PtyCommandTextSinkDependencies = DEFAULT_DEPENDENCIES,
): PtyCommandTextSink {
  const limits = validateLimits(input.limits ?? DEFAULT_PTY_COMMAND_TEXT_SINK_LIMITS);
  const projection = dependencies.createProjection(input.projection);
  const pending: PendingProjectionAction[] = [];
  let pendingBytes = 0;
  let pumpRunning = false;
  let settlementStarted = false;
  let projectionFailed = false;
  let projectionIncomplete = false;
  let settlementPromise: Promise<PtyCommandTextSettlement> | undefined;
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

  function clearPending(): void {
    pending.length = 0;
    pendingBytes = 0;
  }

  function failProjection(): void {
    if (projectionFailed) return;
    projectionFailed = true;
    clearPending();
    input.observation.markProjectionFailed();
  }

  async function pump(): Promise<void> {
    if (pumpRunning) return;
    pumpRunning = true;
    try {
      while (pending.length > 0 && !projectionFailed) {
        const action = pending.shift();
        if (!action) break;
        if (action.kind === 'transcript') pendingBytes -= action.bytes.byteLength;
        try {
          if (action.kind === 'transcript') await projection.write(action.bytes);
          else await projection.resize(action.columns, action.rows);
          const snapshot = await projection.snapshot();
          input.observation.accept({
            stableScreenText: snapshot.stableText,
            screen: snapshot.screen,
          });
        } catch {
          failProjection();
        }
      }
    } finally {
      pumpRunning = false;
      wakeIdleWaiters();
      if (pending.length > 0 && !projectionFailed) void pump();
    }
  }

  function offer(action: PendingProjectionAction): void {
    if (settlementStarted) {
      throw new Error('cannot accept PTY text after settlement started');
    }
    if (projectionFailed || projectionIncomplete) return;
    const actionBytes = action.kind === 'transcript' ? action.bytes.byteLength : 0;
    if (
      pending.length >= limits.maxPendingEvents
      || pendingBytes + actionBytes > limits.maxPendingBytes
    ) {
      // 部分屏幕不能再声称完整；停止所有新派生工作，但 raw artifact 继续由外层接纳。
      projectionIncomplete = true;
      clearPending();
      input.observation.markProjectionFailed();
      return;
    }
    pending.push(action);
    pendingBytes += actionBytes;
    void pump();
  }

  async function abortWriter(
    writer: ToolOutputTextBlobWriter,
  ): Promise<'complete' | 'failed'> {
    try {
      await writer.abort();
      return 'complete';
    } catch {
      return 'failed';
    }
  }

  async function persistStableText(inputPersist: {
    readonly stableText: string;
    readonly sourceCompletion: PtyCommandTextSettlement['sourceCompletion'];
    readonly projectionIncomplete: boolean;
  }): Promise<{
    readonly blob: PtyCommandTextBlobSettlement;
    readonly cleanup: PtyCommandTextSettlement['cleanup'];
  }> {
    if (inputPersist.sourceCompletion === 'not_started') {
      return { blob: { status: 'not_created', reason: 'source_not_started' }, cleanup: 'not_required' };
    }
    if (inputPersist.stableText.length === 0) {
      return { blob: { status: 'not_created', reason: 'empty' }, cleanup: 'not_required' };
    }
    let writer: ToolOutputTextBlobWriter;
    try {
      writer = await input.openWriter();
    } catch {
      return {
        blob: { status: 'unavailable', failureCode: 'writer_open_failed' },
        cleanup: 'not_required',
      };
    }
    try {
      await writer.append(inputPersist.stableText);
    } catch {
      try {
        const prefix = await writer.finalizeCommittedPrefix();
        if (prefix.status === 'published') {
          return {
            blob: {
              status: 'published',
              completeness: 'incomplete',
              blob: prefix.blob,
              persistedCharacters: prefix.persistedCharacters,
              persistedLines: prefix.persistedLines,
            },
            cleanup: prefix.blob.stagingCleanup === 'complete' ? 'complete' : 'pending',
          };
        }
      } catch {
        // append 失败是首个存储故障；前缀封存失败只意味着没有可读取的稳定前缀。
      }
      const cleanup = await abortWriter(writer);
      return {
        blob: { status: 'unavailable', failureCode: 'writer_append_failed' },
        cleanup,
      };
    }
    try {
      const blob = await writer.finalize();
      return {
        blob: {
          status: 'published',
          completeness: inputPersist.sourceCompletion === 'complete'
            && !inputPersist.projectionIncomplete
            ? 'complete'
            : 'incomplete',
          blob,
          persistedCharacters: inputPersist.stableText.length,
          persistedLines: countNewlines(inputPersist.stableText) + 1,
        },
        cleanup: blob.stagingCleanup === 'complete' ? 'complete' : 'pending',
      };
    } catch {
      const cleanup = await abortWriter(writer);
      return {
        blob: { status: 'unavailable', failureCode: 'writer_finalize_failed' },
        cleanup,
      };
    }
  }

  function beginSettlement(
    sourceCompletion: PtyCommandTextSettlement['sourceCompletion'],
  ): Promise<PtyCommandTextSettlement> {
    if (settlementPromise) return settlementPromise;
    settlementStarted = true;
    settlementPromise = (async () => {
      await waitForIdle();
      let projected: PtyCommandProjectionSettlement;
      if (projectionFailed) {
        // finalize 仍是释放 headless parser 的唯一入口；此前失败后不得因测试替身“恢复”
        // 而重新声称屏幕完整。
        try {
          await projection.finalize('interrupted');
        } catch {
          // 已经记录 projection_failed；释放路径的同一失败不产生第二种用户事实。
        }
        projected = Object.freeze({ status: 'failed' as const });
      } else {
        try {
          const finalization = await projection.finalize(
            sourceCompletion === 'complete' ? 'complete' : 'interrupted',
          );
          projected = Object.freeze({
            status: sourceCompletion === 'complete' && !projectionIncomplete
              ? 'complete' as const
              : 'incomplete' as const,
            screen: finalization.screen,
            agentPreview: finalization.agentText,
            stableText: finalization.stableText,
          });
        } catch {
          failProjection();
          projected = Object.freeze({ status: 'failed' as const });
        }
      }

      if (projected.status === 'failed') {
        input.observation.close();
        return Object.freeze({
          sourceCompletion,
          projection: projected,
          blob: Object.freeze({
            status: 'unavailable' as const,
            failureCode: (projectionIncomplete
              ? 'sink_overloaded'
              : 'projection_failed') satisfies PtyCommandTextSinkFailureCode,
          }),
          cleanup: 'not_required' as const,
        });
      }

      input.observation.close({
        stableScreenText: projected.stableText,
        screen: projected.screen,
      });
      const persistence = await persistStableText({
        stableText: projected.stableText,
        sourceCompletion,
        projectionIncomplete,
      });
      return Object.freeze({
        sourceCompletion,
        projection: projected,
        blob: Object.freeze(persistence.blob),
        cleanup: persistence.cleanup,
      });
    })();
    return settlementPromise;
  }

  return Object.freeze({
    accept(bytes) {
      offer({ kind: 'transcript', bytes: Uint8Array.from(bytes) });
    },
    acceptResize(columns, rows) {
      offer({ kind: 'resize', columns, rows });
    },
    settle({ sourceCompletion }) {
      return beginSettlement(sourceCompletion);
    },
    settleBeforeSourceStart() {
      return beginSettlement('not_started');
    },
  } satisfies PtyCommandTextSink);
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) count += 1;
  }
  return count;
}
