import { AsyncLocalStorage } from 'node:async_hooks';
import { projectDurableLlmAuditValue } from '@linnlabs/linnkit';
import { Logger } from 'src/shared/logger';
import type {
  ContextManagerAuditEntry,
  LLMAuditContext,
  LLMAuditStore,
  LlmInputMaterializationAuditInput,
  RunAuditState,
  RunTranscriptAuditEntry,
  ToolProtocolErrorAuditEntry,
} from '../definitions/llmRunAudit';
import {
  getSystemReminderAuditMaxEntriesPerRunKey,
  getToolProtocolErrorAuditMaxEntriesPerRunKey,
  isLLMRunAuditEnabled,
} from '../functions/auditConfiguration';
import { buildCheckpointDocument, buildFinalAuditDocuments } from '../functions/buildAuditDocuments';
import { buildRawArgumentsSummary, cloneAuditValue, isRecord } from '../functions/auditValues';
import {
  removeRunAuditCheckpoint,
  resolveRunAuditPaths,
  writeJsonAtomically,
} from '../persistence/llmRunAuditFileRepository';

const logger = new Logger('LLMRunAudit');
const CHECKPOINT_DEBOUNCE_MS = 500;
const CHECKPOINT_MAX_INTERVAL_MS = 2_000;
const als = new AsyncLocalStorage<LLMAuditStore>();

type AuditProjectionResult<T> =
  | { readonly accepted: true; readonly value: T }
  | { readonly accepted: false };

function projectAuditValue<T>(value: T, stage: string): AuditProjectionResult<T> {
  try {
    return { accepted: true, value: projectDurableLlmAuditValue(value) };
  } catch (error) {
    // 审计片段必须 fail closed，但观测失败不能覆盖正常业务结果。
    logger.error('[LLMRunAudit] 拒绝包含 transient 图片载荷的审计片段', {
      stage,
      error: error instanceof Error ? error.message : String(error),
    });
    return { accepted: false };
  }
}

export function getCurrentLLMAuditContext(): LLMAuditContext | undefined {
  const store = als.getStore();
  if (!store || !Array.isArray(store.stack) || store.stack.length === 0) return undefined;
  return store.stack[store.stack.length - 1];
}

export function recordBeforeContextManager(params: { payload: unknown }): void {
  if (!isLLMRunAuditEnabled() || shouldSkipContextManagerAuditForCurrentChain()) return;
  const runAudit = ensureRunAuditStore();
  if (!runAudit || runAudit.flushed) return;
  const projected = projectAuditValue(params.payload, 'before_context_manager');
  if (!projected.accepted) return;

  runAudit.seq += 1;
  const bucket = ensureCurrentBucket(runAudit);
  if (bucket.before) return;
  bucket.before = {
    seq: runAudit.seq,
    stage: 'before_context_manager',
    timestamp: Date.now(),
    at: new Date().toISOString(),
    audit_context: buildAuditContextSnapshot(),
    payload: cloneAuditValue(projected.value),
  };
  scheduleRunAuditCheckpoint(runAudit);
}

export function recordAfterContextManager(params: {
  contextMessages?: unknown[];
  llmMessages: unknown[];
  toolNames?: string[];
}): void {
  if (!isLLMRunAuditEnabled()) return;
  const runAudit = ensureRunAuditStore();
  if (!runAudit || runAudit.flushed) return;
  const projected = projectAuditValue({
    contextMessages: params.contextMessages,
    llmMessages: params.llmMessages,
    toolNames: params.toolNames,
  }, 'after_context_manager');
  if (!projected.accepted) return;

  runAudit.seq += 1;
  const bucket = ensureCurrentBucket(runAudit);
  const entry: ContextManagerAuditEntry = {
    seq: runAudit.seq,
    stage: 'after_context_manager',
    timestamp: Date.now(),
    at: new Date().toISOString(),
    audit_context: buildAuditContextSnapshot(),
    payload: {
      ...(Array.isArray(projected.value.contextMessages)
        ? { contextMessages: cloneAuditValue(projected.value.contextMessages) }
        : {}),
      llmMessages: cloneAuditValue(projected.value.llmMessages),
      tool_names: projected.value.toolNames,
    },
  };
  bucket.latestAfterForReplay = cloneAuditValue(entry);
  if (!shouldSkipContextManagerAuditForCurrentChain()) {
    bucket.after = entry;
  }
  scheduleRunAuditCheckpoint(runAudit);
}

export function recordToolProtocolError(params: {
  toolName: string;
  toolCallId?: string;
  rawArguments?: string;
  parsedArguments?: Record<string, unknown>;
  error: string;
}): void {
  if (!isLLMRunAuditEnabled()) return;
  const runAudit = ensureRunAuditStore();
  if (!runAudit || runAudit.flushed) return;
  const projected = projectAuditValue(params, 'tool_protocol_error');
  if (!projected.accepted) return;

  const bucket = ensureCurrentBucket(runAudit);
  const latestAfterPayload = isRecord(bucket.latestAfterForReplay?.payload)
    ? bucket.latestAfterForReplay.payload
    : undefined;
  const rawArgumentsSummary = typeof projected.value.rawArguments === 'string'
    ? buildRawArgumentsSummary(projected.value.rawArguments)
    : undefined;
  runAudit.seq += 1;
  const entry: ToolProtocolErrorAuditEntry = {
    seq: runAudit.seq,
    stage: 'tool_protocol_error',
    timestamp: Date.now(),
    at: new Date().toISOString(),
    audit_context: buildAuditContextSnapshot(),
    payload: {
      tool_call: {
        toolName: projected.value.toolName,
        ...(typeof projected.value.toolCallId === 'string' ? { toolCallId: projected.value.toolCallId } : {}),
        ...(typeof projected.value.rawArguments === 'string' ? { rawArguments: projected.value.rawArguments } : {}),
        ...(rawArgumentsSummary ? { rawArgumentsSummary } : {}),
        ...(projected.value.parsedArguments
          ? { parsedArguments: cloneAuditValue(projected.value.parsedArguments) }
          : {}),
      },
      protocol_error: { message: projected.value.error },
      llm_request: {
        ...(Array.isArray(latestAfterPayload?.contextMessages)
          ? { contextMessages: cloneAuditValue(latestAfterPayload.contextMessages) }
          : {}),
        ...(Array.isArray(latestAfterPayload?.llmMessages)
          ? { llmMessages: cloneAuditValue(latestAfterPayload.llmMessages) }
          : {}),
        ...(Array.isArray(latestAfterPayload?.tool_names)
          ? { tool_names: cloneAuditValue(latestAfterPayload.tool_names) }
          : {}),
      },
    },
  };

  bucket.toolProtocolErrors ??= [];
  bucket.toolProtocolErrors.push(entry);
  const maxEntries = getToolProtocolErrorAuditMaxEntriesPerRunKey();
  if (bucket.toolProtocolErrors.length > maxEntries) {
    const dropped = bucket.toolProtocolErrors.length - maxEntries;
    bucket.toolProtocolErrors.splice(0, dropped);
    bucket.toolProtocolErrorsDroppedCount = (bucket.toolProtocolErrorsDroppedCount ?? 0) + dropped;
  }
  scheduleRunAuditCheckpoint(runAudit);
}

export function recordAfterContextManagerOnSystemReminderHit(params: {
  contextMessages?: unknown[];
  llmMessages: unknown[];
  toolNames?: string[];
  systemReminder: { ruleIds: string[] };
}): void {
  if (!isLLMRunAuditEnabled() || shouldSkipContextManagerAuditForCurrentChain()) return;
  const runAudit = ensureRunAuditStore();
  if (!runAudit || runAudit.flushed) return;
  const projected = projectAuditValue(params, 'after_context_manager_system_reminder');
  if (!projected.accepted) return;

  runAudit.seq += 1;
  const bucket = ensureCurrentBucket(runAudit);
  const entry: ContextManagerAuditEntry = {
    seq: runAudit.seq,
    stage: 'after_context_manager',
    timestamp: Date.now(),
    at: new Date().toISOString(),
    audit_context: buildAuditContextSnapshot(),
    payload: {
      ...(Array.isArray(projected.value.contextMessages)
        ? { contextMessages: cloneAuditValue(projected.value.contextMessages) }
        : {}),
      llmMessages: cloneAuditValue(projected.value.llmMessages),
      tool_names: projected.value.toolNames,
      system_reminder: { rule_ids: projected.value.systemReminder.ruleIds },
    },
  };

  bucket.systemReminderAfterSnapshots ??= [];
  bucket.systemReminderAfterSnapshots.push(entry);
  const maxEntries = getSystemReminderAuditMaxEntriesPerRunKey();
  if (bucket.systemReminderAfterSnapshots.length > maxEntries) {
    const dropped = bucket.systemReminderAfterSnapshots.length - maxEntries;
    bucket.systemReminderAfterSnapshots.splice(0, dropped);
    bucket.systemReminderAfterSnapshotsDroppedCount =
      (bucket.systemReminderAfterSnapshotsDroppedCount ?? 0) + dropped;
  }
  scheduleRunAuditCheckpoint(runAudit);
}

export function recordRunTranscript(params: {
  transcriptMessages: unknown[];
  toolset?: RunTranscriptAuditEntry['payload']['toolset'];
}): void {
  if (!isLLMRunAuditEnabled()) return;
  const runAudit = ensureRunAuditStore();
  if (!runAudit || runAudit.flushed) return;
  const projected = projectAuditValue(params, 'run_transcript');
  if (!projected.accepted) return;

  runAudit.seq += 1;
  ensureCurrentBucket(runAudit).transcript = {
    seq: runAudit.seq,
    stage: 'run_transcript',
    timestamp: Date.now(),
    at: new Date().toISOString(),
    audit_context: buildAuditContextSnapshot(),
    payload: {
      transcriptMessages: cloneAuditValue(projected.value.transcriptMessages),
      toolset: projected.value.toolset,
    },
  };
  scheduleRunAuditCheckpoint(runAudit);
}

export function recordLlmInputMaterializationEvidence(
  params: LlmInputMaterializationAuditInput,
): void {
  if (!isLLMRunAuditEnabled()) return;
  const runAudit = ensureRunAuditStore();
  if (!runAudit || runAudit.flushed) return;
  const projected = projectAuditValue(params, 'llm_input_materialization');
  if (!projected.accepted) return;

  runAudit.seq += 1;
  const bucket = ensureCurrentBucket(runAudit);
  bucket.materializationAttempts ??= [];
  bucket.materializationAttempts.push({
    seq: runAudit.seq,
    stage: 'llm_input_materialization',
    timestamp: Date.now(),
    at: new Date().toISOString(),
    audit_context: buildAuditContextSnapshot(),
    payload: {
      active_model_id: projected.value.activeModelId,
      profile_id: projected.value.profileId,
      estimator_version: projected.value.estimatorVersion,
      api_surface: projected.value.apiSurface,
      input_budget: projected.value.inputBudget,
      non_image_estimated_tokens: projected.value.nonImageEstimatedTokens,
      attachment_evidence: projected.value.attachmentEvidence,
    },
  });
  scheduleRunAuditCheckpoint(runAudit);
}

export async function flushRunContextManagerAuditToDisk(): Promise<void> {
  if (!isLLMRunAuditEnabled()) return;
  const store = als.getStore();
  if (!store?.runAudit || store.runAudit.flushed) return;
  const context = getCurrentLLMAuditContext();
  if (!context) return;

  clearCheckpointTimers(store.runAudit);
  const rootContext = getRootLLMAuditContext() ?? context;
  await enqueueRunAuditCheckpoint(store.runAudit, rootContext);
  await store.runAudit.checkpoint.writeQueue;
  const paths = await resolveRunAuditPaths(store.runAudit, rootContext);
  const documents = buildFinalAuditDocuments({
    runAudit: store.runAudit,
    auditContext: buildAuditContextSnapshot(),
    flushedAt: new Date(),
  });

  await Promise.all([
    writeJsonAtomically(paths.beforePath, JSON.stringify(documents.before, null, 2)),
    writeJsonAtomically(paths.afterPath, JSON.stringify(documents.after, null, 2)),
    writeJsonAtomically(paths.toolProtocolErrorsPath, JSON.stringify(documents.toolProtocolErrors, null, 2)),
  ]);
  store.runAudit.flushed = true;
  // 最终文件写入期间可能已有 timer 回调进入队列；先关闭调度并排空队列，
  // 再删除 checkpoint，才能保证终态之后不会被迟到写入重新创建。
  clearCheckpointTimers(store.runAudit);
  await store.runAudit.checkpoint.writeQueue;
  await removeRunAuditCheckpoint(paths);
}

export async function runWithLLMAuditContext<T>(
  contextPatch: Partial<LLMAuditContext>,
  run: () => Promise<T>,
): Promise<T> {
  if (!isLLMRunAuditEnabled()) return await run();
  const merged = mergeAuditContext(getCurrentLLMAuditContext(), contextPatch);
  if (!merged) return await run();

  const parentStore = als.getStore();
  const nextStack = parentStore ? [...parentStore.stack, merged] : [merged];
  const store: LLMAuditStore = { stack: nextStack, runAudit: parentStore?.runAudit };
  return await als.run(store, async () => {
    if (!parentStore) {
      const runAudit = ensureRunAuditStore();
      if (runAudit) await enqueueRunAuditCheckpoint(runAudit, merged);
    }
    return await run();
  });
}

function ensureRunAuditStore(): RunAuditState | undefined {
  const store = als.getStore();
  if (!store) return undefined;
  store.runAudit ??= {
    startedAtIso: new Date().toISOString(),
    seq: 0,
    byRunKey: {},
    flushed: false,
    checkpoint: {
      writeQueue: Promise.resolve(),
      lastEnqueuedSeq: -1,
      lastWrittenSeq: -1,
    },
  };
  return store.runAudit;
}

function ensureCurrentBucket(runAudit: RunAuditState) {
  const runKey = getCurrentAuditRunKey();
  runAudit.byRunKey[runKey] ??= {};
  return runAudit.byRunKey[runKey];
}

function buildAuditContextSnapshot(): ContextManagerAuditEntry['audit_context'] | undefined {
  const context = getCurrentLLMAuditContext();
  if (!context) return undefined;
  return {
    conversationId: context.conversationId,
    runId: context.runId,
    traceId: context.traceId,
    subrunId: context.subrunId,
    parentToolCallId: context.parentToolCallId,
    source: context.source,
  };
}

function getCurrentAuditRunKey(): string {
  const subrunId = getCurrentLLMAuditContext()?.subrunId?.trim();
  return subrunId ? `subrun:${subrunId}` : 'root';
}

function shouldSkipContextManagerAuditForCurrentChain(): boolean {
  return !!getCurrentLLMAuditContext()?.subrunId?.trim();
}

function getRootLLMAuditContext(): LLMAuditContext | undefined {
  return als.getStore()?.stack[0];
}

function clearCheckpointTimers(runAudit: RunAuditState): void {
  if (runAudit.checkpoint.debounceTimer) {
    clearTimeout(runAudit.checkpoint.debounceTimer);
    runAudit.checkpoint.debounceTimer = undefined;
  }
  if (runAudit.checkpoint.maxIntervalTimer) {
    clearTimeout(runAudit.checkpoint.maxIntervalTimer);
    runAudit.checkpoint.maxIntervalTimer = undefined;
  }
}

function enqueueRunAuditCheckpoint(runAudit: RunAuditState, context: LLMAuditContext): Promise<void> {
  if (runAudit.flushed) return runAudit.checkpoint.writeQueue;
  const seq = runAudit.seq;
  if (seq <= runAudit.checkpoint.lastEnqueuedSeq) return runAudit.checkpoint.writeQueue;

  let serialized: string;
  try {
    serialized = JSON.stringify(buildCheckpointDocument({ runAudit, context, seq }), null, 2);
  } catch (error) {
    logger.error('[LLMRunAudit] 无法序列化增量审计快照', { runId: context.runId, seq, error });
    return runAudit.checkpoint.writeQueue;
  }

  runAudit.checkpoint.lastEnqueuedSeq = seq;
  runAudit.checkpoint.writeQueue = runAudit.checkpoint.writeQueue
    .then(async () => {
      if (runAudit.flushed) return;
      if (seq <= runAudit.checkpoint.lastWrittenSeq) return;
      const paths = await resolveRunAuditPaths(runAudit, context);
      await writeJsonAtomically(paths.checkpointPath, serialized);
      runAudit.checkpoint.lastWrittenSeq = seq;
    })
    .catch((error: unknown) => {
      logger.error('[LLMRunAudit] 增量审计快照写入失败', {
        conversationId: context.conversationId,
        runId: context.runId,
        seq,
        error,
      });
    });
  return runAudit.checkpoint.writeQueue;
}

function flushScheduledCheckpoint(runAudit: RunAuditState): void {
  clearCheckpointTimers(runAudit);
  if (runAudit.flushed) return;
  const context = getRootLLMAuditContext();
  if (context) void enqueueRunAuditCheckpoint(runAudit, context);
}

function scheduleRunAuditCheckpoint(runAudit: RunAuditState): void {
  if (runAudit.flushed) return;
  if (runAudit.checkpoint.debounceTimer) clearTimeout(runAudit.checkpoint.debounceTimer);
  runAudit.checkpoint.debounceTimer = setTimeout(
    () => flushScheduledCheckpoint(runAudit),
    CHECKPOINT_DEBOUNCE_MS,
  );
  runAudit.checkpoint.debounceTimer.unref?.();
  if (!runAudit.checkpoint.maxIntervalTimer) {
    runAudit.checkpoint.maxIntervalTimer = setTimeout(
      () => flushScheduledCheckpoint(runAudit),
      CHECKPOINT_MAX_INTERVAL_MS,
    );
    runAudit.checkpoint.maxIntervalTimer.unref?.();
  }
}

function mergeAuditContext(
  parent: LLMAuditContext | undefined,
  patch: Partial<LLMAuditContext>,
): LLMAuditContext | undefined {
  if (parent) return { ...parent, ...patch };
  if (typeof patch.conversationId !== 'string' || patch.conversationId.trim().length === 0) return undefined;
  if (typeof patch.runId !== 'string' || patch.runId.trim().length === 0) return undefined;

  const context: LLMAuditContext = { conversationId: patch.conversationId, runId: patch.runId };
  if (typeof patch.traceId === 'string' && patch.traceId.trim()) context.traceId = patch.traceId;
  if (typeof patch.subrunId === 'string' && patch.subrunId.trim()) context.subrunId = patch.subrunId;
  if (typeof patch.parentToolCallId === 'string' && patch.parentToolCallId.trim()) {
    context.parentToolCallId = patch.parentToolCallId;
  }
  if (typeof patch.source === 'string' && patch.source.trim()) context.source = patch.source;
  return context;
}
