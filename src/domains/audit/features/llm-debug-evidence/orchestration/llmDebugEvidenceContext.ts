import { AsyncLocalStorage } from 'node:async_hooks';
import { generateAuditEnvelopeId, projectDurableLlmAuditValue } from '@linnlabs/linnkit';
import { AuditEnvelope, ConversationIdSchema, RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import { Logger } from 'src/shared/logger';
import type { AuditLevel } from '../../../definitions/auditLevel';
import type {
  LLMDebugEvidenceContext,
  LlmInputMaterializationDebugEvidenceInput,
  RunTranscriptDebugEvidenceToolset,
} from '../definitions/llmDebugEvidence';

const logger = new Logger('UnifiedAudit');
const MAX_PROTOCOL_ERRORS_PER_RUN = 16;
const MAX_SYSTEM_REMINDERS_PER_RUN = 16;
const MAX_DEBUG_EVENTS_PER_RUN = 256;
const MAX_DEBUG_EVIDENCE_BYTES = 512 * 1024;

const als = new AsyncLocalStorage<LLMDebugEvidenceStore>();
let configuration: LlmDebugEvidenceConfiguration | undefined;

interface LlmDebugEvidenceConfiguration {
  readonly level: AuditLevel;
  readonly auditPort: AuditPort;
}

interface LlmDebugEvidenceState {
  readonly auditPort: AuditPort;
  sequence: number;
  emittedEvents: number;
  protocolErrorCount: number;
  systemReminderCount: number;
  beforeRecorded: boolean;
  flushed: boolean;
  latestAfterPayload?: {
    readonly contextMessages?: unknown[];
    readonly llmMessages?: unknown[];
    readonly toolNames?: string[];
  };
  pending: Promise<void>;
}

interface LLMDebugEvidenceStore {
  readonly stack: LLMDebugEvidenceContext[];
  readonly debugEvidence: LlmDebugEvidenceState;
}

export function configureLlmDebugEvidence(options: {
  readonly auditPort: AuditPort;
  readonly level: AuditLevel;
}): void {
  configuration = options;
}

export function resetLlmDebugEvidenceForTest(): void {
  configuration = undefined;
}

export function getCurrentLLMDebugEvidenceContext(): LLMDebugEvidenceContext | undefined {
  const store = als.getStore();
  return store?.stack[store.stack.length - 1];
}

export function recordBeforeContextManager(params: { payload: unknown }): void {
  const state = getDebugState();
  if (!state || state.beforeRecorded) return;

  const context = getCurrentLLMDebugEvidenceContext();
  if (!context || isChildRun(context)) return;
  const payload = projectDebugEvidenceValue(params.payload, 'before_context_manager');
  if (payload === undefined) return;

  state.beforeRecorded = true;
  emitLlmDebugEvidenceEvent(state, context, 'llm.context.before', {
    stage: 'before_context_manager',
    payload,
  });
}

export function recordAfterContextManager(params: {
  contextMessages?: unknown[];
  llmMessages: unknown[];
  toolNames?: string[];
}): void {
  const state = getDebugState();
  if (!state) return;

  const context = getCurrentLLMDebugEvidenceContext();
  if (!context) return;
  const payload = projectDebugEvidenceValue(params, 'after_context_manager');
  if (!isRecord(payload)) return;

  const contextMessages = Array.isArray(payload.contextMessages)
    ? payload.contextMessages
    : undefined;
  const llmMessages = Array.isArray(payload.llmMessages) ? payload.llmMessages : [];
  const toolNames =
    Array.isArray(payload.toolNames) &&
    payload.toolNames.every((value): value is string => typeof value === 'string')
      ? payload.toolNames
      : undefined;

  state.latestAfterPayload = { contextMessages, llmMessages, toolNames };
  if (isChildRun(context)) return;
  emitLlmDebugEvidenceEvent(state, context, 'llm.context.after', {
    stage: 'after_context_manager',
    payload: {
      ...(contextMessages ? { contextMessages } : {}),
      llmMessages,
      ...(toolNames ? { toolNames } : {}),
    },
  });
}

export function recordToolProtocolError(params: {
  toolName: string;
  toolCallId?: string;
  rawArguments?: string;
  parsedArguments?: Record<string, unknown>;
  error: string;
}): void {
  const state = getDebugState();
  if (!state || state.protocolErrorCount >= MAX_PROTOCOL_ERRORS_PER_RUN) return;

  const context = getCurrentLLMDebugEvidenceContext();
  if (!context) return;
  const payload = projectDebugEvidenceValue(params, 'tool_protocol_error');
  if (!isRecord(payload)) return;

  state.protocolErrorCount += 1;
  const latestAfter = state.latestAfterPayload;
  emitLlmDebugEvidenceEvent(state, context, 'llm.tool_protocol_error', {
    stage: 'tool_protocol_error',
    payload: {
      toolCall: {
        toolName: payload.toolName,
        ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
        ...(typeof payload.rawArguments === 'string'
          ? {
              rawArguments: payload.rawArguments,
              rawArgumentsSummary: summarizeRawArguments(payload.rawArguments),
            }
          : {}),
        ...(isRecord(payload.parsedArguments) ? { parsedArguments: payload.parsedArguments } : {}),
      },
      protocolError: { message: payload.error },
      llmRequest: latestAfter,
    },
  });
}

export function recordAfterContextManagerOnSystemReminderHit(params: {
  contextMessages?: unknown[];
  llmMessages: unknown[];
  toolNames?: string[];
  systemReminder: { ruleIds: string[] };
}): void {
  const state = getDebugState();
  if (!state || state.systemReminderCount >= MAX_SYSTEM_REMINDERS_PER_RUN) return;

  const context = getCurrentLLMDebugEvidenceContext();
  if (!context || isChildRun(context)) return;
  const payload = projectDebugEvidenceValue(params, 'after_context_manager_system_reminder');
  if (!isRecord(payload)) return;

  state.systemReminderCount += 1;
  emitLlmDebugEvidenceEvent(state, context, 'llm.context.system_reminder', {
    stage: 'after_context_manager',
    payload,
  });
}

export function recordRunTranscript(params: {
  transcriptMessages: unknown[];
  toolset?: RunTranscriptDebugEvidenceToolset;
}): void {
  const state = getDebugState();
  if (!state) return;

  const context = getCurrentLLMDebugEvidenceContext();
  if (!context) return;
  const payload = projectDebugEvidenceValue(params, 'run_transcript');
  if (payload === undefined) return;

  emitLlmDebugEvidenceEvent(state, context, 'llm.transcript', {
    stage: 'run_transcript',
    payload,
  });
}

export function recordLlmInputMaterializationEvidence(
  params: LlmInputMaterializationDebugEvidenceInput
): void {
  const state = getDebugState();
  if (!state) return;

  const context = getCurrentLLMDebugEvidenceContext();
  if (!context) return;
  const payload = projectDebugEvidenceValue(params, 'llm_input_materialization');
  if (payload === undefined) return;

  emitLlmDebugEvidenceEvent(state, context, 'llm.input_materialization', {
    stage: 'llm_input_materialization',
    payload,
  });
}

/**
 * 排空当前 run 的统一审计队列。
 *
 * Phase 0 后调用方只面对统一 AuditPort。具体写入 EventStore 还是有界开发诊断目录
 * 由 Audit Runtime 按 action 和等级决定，runner 不拥有存储路径或 retention。
 */
export async function flushLinnyaAudit(): Promise<void> {
  const store = als.getStore();
  if (!store || store.debugEvidence.flushed) return;

  store.debugEvidence.flushed = true;
  await store.debugEvidence.pending;
  await store.debugEvidence.auditPort.flush?.();
}

export async function runWithLLMDebugEvidenceContext<T>(
  contextPatch: Partial<LLMDebugEvidenceContext>,
  run: () => Promise<T>
): Promise<T> {
  if (configuration?.level !== 'debug') return await run();

  const merged = mergeDebugEvidenceContext(getCurrentLLMDebugEvidenceContext(), contextPatch);
  if (!merged) return await run();

  const parentStore = als.getStore();
  const store: LLMDebugEvidenceStore = parentStore ?? {
    stack: [],
    debugEvidence: createDebugEvidenceState(),
  };
  return await als.run(
    {
      stack: [...store.stack, merged],
      debugEvidence: store.debugEvidence,
    },
    run
  );
}

function getDebugState(): LlmDebugEvidenceState | undefined {
  if (configuration?.level !== 'debug') return undefined;
  const store = als.getStore();
  if (!store || store.debugEvidence.flushed) return undefined;
  return store.debugEvidence;
}

function createDebugEvidenceState(): LlmDebugEvidenceState {
  const auditPort = configuration?.auditPort;
  if (!auditPort) {
    throw new Error(
      'Unified audit runtime must be configured before creating an LLM debug evidence scope'
    );
  }
  return {
    auditPort,
    sequence: 0,
    emittedEvents: 0,
    protocolErrorCount: 0,
    systemReminderCount: 0,
    beforeRecorded: false,
    flushed: false,
    pending: Promise.resolve(),
  };
}

function emitLlmDebugEvidenceEvent(
  state: LlmDebugEvidenceState,
  context: LLMDebugEvidenceContext,
  action: string,
  input: {
    readonly stage: string;
    readonly payload: unknown;
  }
): void {
  if (state.emittedEvents >= MAX_DEBUG_EVENTS_PER_RUN) {
    if (state.emittedEvents === MAX_DEBUG_EVENTS_PER_RUN) {
      logger.warn('[UnifiedAudit] LLM debug evidence 达到单次 run 上限，后续片段已丢弃', {
        runId: context.runId,
        limit: MAX_DEBUG_EVENTS_PER_RUN,
      });
      state.emittedEvents += 1;
    }
    return;
  }

  const projected = projectDebugEvidenceValue(input.payload, input.stage);
  if (projected === undefined) return;

  state.sequence += 1;
  state.emittedEvents += 1;
  const envelope = createLlmDebugEvidenceEnvelope({
    context,
    action,
    stage: input.stage,
    sequence: state.sequence,
    payload: projected,
  });
  if (!envelope) return;

  const auditPort = state.auditPort;
  state.pending = state.pending
    .then(async () => await auditPort.emit(envelope))
    .catch(error => {
      logger.error('[UnifiedAudit] LLM debug evidence 写入失败', {
        action,
        conversationId: context.conversationId,
        runId: context.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function createLlmDebugEvidenceEnvelope(params: {
  readonly context: LLMDebugEvidenceContext;
  readonly action: string;
  readonly stage: string;
  readonly sequence: number;
  readonly payload: unknown;
}): ReturnType<typeof AuditEnvelope.parse> | undefined {
  const projected = projectDebugEvidenceValue(
    {
      stage: params.stage,
      sequence: params.sequence,
      payload: params.payload,
    },
    params.stage
  );
  if (!isRecord(projected)) return undefined;

  try {
    const conversationId = ConversationIdSchema.parse(params.context.conversationId);
    const runId = RunIdSchema.parse(params.context.runId);
    return AuditEnvelope.parse({
      envelopeId: generateAuditEnvelopeId(),
      runId,
      ts: Date.now(),
      actor: { kind: 'host', name: 'linnya-audit' },
      action: params.action,
      evidence: [
        {
          kind: 'llm_debug_evidence',
          metadata: projected,
        },
      ],
      scope: {
        conversationId,
        runId,
        ...(params.context.traceId ? { traceId: params.context.traceId } : {}),
        ...(params.context.subrunId ? { metadata: { subrunId: params.context.subrunId } } : {}),
        ...(params.context.parentToolCallId
          ? {
              metadata: {
                ...(params.context.subrunId ? { subrunId: params.context.subrunId } : {}),
                parentToolCallId: params.context.parentToolCallId,
              },
            }
          : {}),
      },
    });
  } catch (error) {
    logger.error('[UnifiedAudit] LLM debug evidence 未通过合同校验', {
      action: params.action,
      conversationId: params.context.conversationId,
      runId: params.context.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function projectDebugEvidenceValue(value: unknown, stage: string): unknown | undefined {
  try {
    const projected = projectDurableLlmAuditValue(value);
    const serialized = JSON.stringify(projected);
    if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_DEBUG_EVIDENCE_BYTES) {
      logger.warn('[UnifiedAudit] LLM debug evidence 超过大小上限，已丢弃', {
        stage,
        maxBytes: MAX_DEBUG_EVIDENCE_BYTES,
      });
      return undefined;
    }
    return projected;
  } catch (error) {
    logger.error('[UnifiedAudit] 拒绝不满足 durable 合同的 LLM debug evidence', {
      stage,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function mergeDebugEvidenceContext(
  parent: LLMDebugEvidenceContext | undefined,
  patch: Partial<LLMDebugEvidenceContext>
): LLMDebugEvidenceContext | undefined {
  if (parent) return { ...parent, ...patch };
  if (typeof patch.conversationId !== 'string' || patch.conversationId.trim().length === 0) {
    return undefined;
  }
  if (typeof patch.runId !== 'string' || patch.runId.trim().length === 0) return undefined;
  return {
    conversationId: patch.conversationId,
    runId: patch.runId,
    ...(patch.traceId ? { traceId: patch.traceId } : {}),
    ...(patch.subrunId ? { subrunId: patch.subrunId } : {}),
    ...(patch.parentToolCallId ? { parentToolCallId: patch.parentToolCallId } : {}),
    ...(patch.source ? { source: patch.source } : {}),
  };
}

function summarizeRawArguments(rawArguments: string): {
  readonly length: number;
  readonly head: string;
  readonly tail: string;
} {
  const maxPreviewLength = 256;
  return {
    length: rawArguments.length,
    head: rawArguments.slice(0, maxPreviewLength),
    tail: rawArguments.slice(-maxPreviewLength),
  };
}

function isChildRun(context: LLMDebugEvidenceContext): boolean {
  return Boolean(context.subrunId?.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
