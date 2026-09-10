import { AsyncLocalStorage } from 'node:async_hooks';
import { generateAuditEnvelopeId, projectDurableLlmAuditValue } from '@linnlabs/linnkit';
import { AuditEnvelope, ConversationIdSchema, RunIdSchema } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';
import { Logger } from 'src/shared/logger';
import type { AuditLevel } from '../../../definitions/auditLevel';
import type {
  LlmAuditContext,
  LlmInputMaterializationAuditInput,
  LlmResponseAuditSummaryInput,
  LlmStreamAuditEventInput,
  RunTranscriptAuditToolset,
} from '../definitions/llmEvidence';

const logger = new Logger('UnifiedAudit');
const MAX_PROTOCOL_ERRORS_PER_RUN = 16;
const MAX_SYSTEM_REMINDERS_PER_RUN = 16;
const MAX_RESPONSE_EVENTS_PER_RUN = 64;
const MAX_RESPONSE_EVIDENCE_BYTES_PER_RUN = 1024 * 1024;
const MAX_STREAM_EVENTS_PER_RUN = 256;
const MAX_STREAM_EVIDENCE_BYTES = 512 * 1024;
const MAX_STREAM_EVIDENCE_BYTES_PER_RUN = 16 * 1024 * 1024;

const als = new AsyncLocalStorage<LlmEvidenceStore>();
let configuration: LlmEvidenceConfiguration | undefined;

interface LlmEvidenceConfiguration {
  readonly level: AuditLevel;
  readonly auditPort: AuditPort;
}

interface LlmEvidenceState {
  readonly auditPort: AuditPort;
  sequence: number;
  emittedEvents: number;
  emittedBytes: number;
  responseEventCount: number;
  responseBytes: number;
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

interface LlmEvidenceStore {
  readonly stack: LlmAuditContext[];
  readonly evidence: LlmEvidenceState;
}

export function configureLlmEvidence(options: {
  readonly auditPort: AuditPort;
  readonly level: AuditLevel;
}): void {
  configuration = options;
}

export function resetLlmAuditForTest(): void {
  configuration = undefined;
}

export function getCurrentLlmAuditContext(): LlmAuditContext | undefined {
  const store = als.getStore();
  return store?.stack[store.stack.length - 1];
}

export function recordBeforeContextManager(params: { payload: unknown }): void {
  const state = getStreamEvidenceState();
  if (!state || state.beforeRecorded) return;

  const context = getCurrentLlmAuditContext();
  if (!context || isChildRun(context)) return;
  const payload = projectLlmEvidenceValue(params.payload, 'before_context_manager');
  if (payload === undefined) return;

  state.beforeRecorded = true;
  emitLlmStreamEvidenceEvent(state, context, 'llm.context.before', {
    stage: 'before_context_manager',
    payload,
  });
}

export function recordAfterContextManager(params: {
  contextMessages?: unknown[];
  llmMessages: unknown[];
  toolNames?: string[];
}): void {
  const state = getStreamEvidenceState();
  if (!state) return;

  const context = getCurrentLlmAuditContext();
  if (!context) return;
  const payload = projectLlmEvidenceValue(params, 'after_context_manager');
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
  emitLlmStreamEvidenceEvent(state, context, 'llm.context.after', {
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
  const state = getStreamEvidenceState();
  if (!state || state.protocolErrorCount >= MAX_PROTOCOL_ERRORS_PER_RUN) return;

  const context = getCurrentLlmAuditContext();
  if (!context) return;
  const payload = projectLlmEvidenceValue(params, 'tool_protocol_error');
  if (!isRecord(payload)) return;

  state.protocolErrorCount += 1;
  const latestAfter = state.latestAfterPayload;
  emitLlmStreamEvidenceEvent(state, context, 'llm.tool_protocol_error', {
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
  const state = getStreamEvidenceState();
  if (!state || state.systemReminderCount >= MAX_SYSTEM_REMINDERS_PER_RUN) return;

  const context = getCurrentLlmAuditContext();
  if (!context || isChildRun(context)) return;
  const payload = projectLlmEvidenceValue(params, 'after_context_manager_system_reminder');
  if (!isRecord(payload)) return;

  state.systemReminderCount += 1;
  emitLlmStreamEvidenceEvent(state, context, 'llm.context.system_reminder', {
    stage: 'after_context_manager',
    payload,
  });
}

export function recordRunTranscript(params: {
  transcriptMessages: unknown[];
  toolset?: RunTranscriptAuditToolset;
}): void {
  const state = getStreamEvidenceState();
  if (!state) return;

  const context = getCurrentLlmAuditContext();
  if (!context) return;
  const payload = projectLlmEvidenceValue(params, 'run_transcript');
  if (payload === undefined) return;

  emitLlmStreamEvidenceEvent(state, context, 'llm.transcript', {
    stage: 'run_transcript',
    payload,
  });
}

export function recordLlmInputMaterializationEvidence(
  params: LlmInputMaterializationAuditInput
): void {
  const state = getStreamEvidenceState();
  if (!state) return;

  const context = getCurrentLlmAuditContext();
  if (!context) return;
  const payload = projectLlmEvidenceValue(params, 'llm_input_materialization');
  if (payload === undefined) return;

  emitLlmStreamEvidenceEvent(state, context, 'llm.input_materialization', {
    stage: 'llm_input_materialization',
    payload,
  });
}

/**
 * 记录一次真实 Provider attempt 的安全终态摘要。
 *
 * 该函数只消费 Host inference adapter 已经完成的白名单投影，不读取 Provider diagnostics
 * 的内部状态，也不接收 response 正文、raw usage 或错误 message。
 */
export function recordLlmResponseSummary(params: LlmResponseAuditSummaryInput): void {
  const state = getResponseState();
  if (!state) return;

  const context = getCurrentLlmAuditContext();
  if (!context) return;
  if (state.responseEventCount >= MAX_RESPONSE_EVENTS_PER_RUN) {
    if (state.responseEventCount === MAX_RESPONSE_EVENTS_PER_RUN) {
      logger.warn('[UnifiedAudit] LLM response 摘要达到单次 run 上限，后续 attempt 已丢弃', {
        runId: context.runId,
        limit: MAX_RESPONSE_EVENTS_PER_RUN,
      });
      state.responseEventCount += 1;
    }
    return;
  }
  const payload = projectLlmEvidenceValue(params, 'response_summary');
  if (!isRecord(payload)) return;

  state.responseEventCount += 1;
  const action = params.outcome === 'succeeded' ? 'llm.response.succeeded' : 'llm.response.failed';
  const envelope = createLlmEvidenceEnvelope({
    context,
    action,
    evidenceKind: 'llm_response_summary',
    payload,
    modelId: params.modelId,
    traceId: params.traceId,
  });
  if (!envelope) return;
  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  if (state.responseBytes + envelopeBytes > MAX_RESPONSE_EVIDENCE_BYTES_PER_RUN) {
    if (state.responseBytes < MAX_RESPONSE_EVIDENCE_BYTES_PER_RUN) {
      logger.warn('[UnifiedAudit] LLM response 摘要达到单次 run 字节上限，后续 attempt 已丢弃', {
        runId: context.runId,
        limitBytes: MAX_RESPONSE_EVIDENCE_BYTES_PER_RUN,
      });
      state.responseBytes = MAX_RESPONSE_EVIDENCE_BYTES_PER_RUN;
    }
    return;
  }
  state.responseBytes += envelopeBytes;
  enqueueLlmEvidence(state, envelope, action, context);
}

/** 记录一个已经过 Audit Domain 白名单投影的 canonical Provider stream 片段。 */
export function recordLlmStreamEvent(params: LlmStreamAuditEventInput): void {
  const state = getStreamEvidenceState();
  if (!state) return;

  const context = getCurrentLlmAuditContext();
  if (!context) return;
  emitLlmStreamEvidenceEvent(state, context, `llm.stream.${params.event.type}`, {
    stage: 'provider_stream_event',
    payload: params,
  });
}

/**
 * 排空当前 run 的统一审计队列。
 *
 * 调用方只面对统一 AuditPort。高体积流式证据也进入同一个 durable sink，
 * runner 不拥有存储路径或 retention；容量和脱敏限制在本 feature 内先做一次投影。
 */
export async function flushLinnyaAudit(): Promise<void> {
  const store = als.getStore();
  if (!store || store.evidence.flushed) return;

  store.evidence.flushed = true;
  await store.evidence.pending;
  await store.evidence.auditPort.flush?.();
}

export async function runWithLlmAuditContext<T>(
  contextPatch: Partial<LlmAuditContext>,
  run: () => Promise<T>
): Promise<T> {
  if (configuration?.level !== 'response' && configuration?.level !== 'stream') {
    return await run();
  }

  const merged = mergeLlmAuditContext(getCurrentLlmAuditContext(), contextPatch);
  if (!merged) return await run();

  const parentStore = als.getStore();
  const store: LlmEvidenceStore = parentStore ?? {
    stack: [],
    evidence: createLlmEvidenceState(),
  };
  return await als.run(
    {
      stack: [...store.stack, merged],
      evidence: store.evidence,
    },
    run
  );
}

function getStreamEvidenceState(): LlmEvidenceState | undefined {
  if (configuration?.level !== 'stream') return undefined;
  const store = als.getStore();
  if (!store || store.evidence.flushed) return undefined;
  return store.evidence;
}

function getResponseState(): LlmEvidenceState | undefined {
  if (configuration?.level !== 'response' && configuration?.level !== 'stream') return undefined;
  const store = als.getStore();
  if (!store || store.evidence.flushed) return undefined;
  return store.evidence;
}

function createLlmEvidenceState(): LlmEvidenceState {
  const auditPort = configuration?.auditPort;
  if (!auditPort) {
    throw new Error(
      'Unified audit runtime must be configured before creating an LLM evidence scope'
    );
  }
  return {
    auditPort,
    sequence: 0,
    emittedEvents: 0,
    emittedBytes: 0,
    responseEventCount: 0,
    responseBytes: 0,
    protocolErrorCount: 0,
    systemReminderCount: 0,
    beforeRecorded: false,
    flushed: false,
    pending: Promise.resolve(),
  };
}

function emitLlmStreamEvidenceEvent(
  state: LlmEvidenceState,
  context: LlmAuditContext,
  action: string,
  input: {
    readonly stage: string;
    readonly payload: unknown;
  }
): void {
  if (state.emittedEvents >= MAX_STREAM_EVENTS_PER_RUN) {
    if (state.emittedEvents === MAX_STREAM_EVENTS_PER_RUN) {
      logger.warn('[UnifiedAudit] LLM stream evidence 达到单次 run 上限，后续片段已丢弃', {
        runId: context.runId,
        limit: MAX_STREAM_EVENTS_PER_RUN,
      });
      state.emittedEvents += 1;
    }
    return;
  }

  const projected = projectLlmEvidenceValue(input.payload, input.stage);
  if (projected === undefined) return;

  state.sequence += 1;
  state.emittedEvents += 1;
  const envelope = createLlmEvidenceEnvelope({
    context,
    action,
    evidenceKind: 'llm_stream_evidence',
    payload: {
      stage: input.stage,
      sequence: state.sequence,
      payload: projected,
    },
  });
  if (!envelope) return;

  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
  if (state.emittedBytes + envelopeBytes > MAX_STREAM_EVIDENCE_BYTES_PER_RUN) {
    if (state.emittedBytes < MAX_STREAM_EVIDENCE_BYTES_PER_RUN) {
      logger.warn('[UnifiedAudit] LLM stream evidence 达到单次 run 字节上限，后续片段已丢弃', {
        runId: context.runId,
        limitBytes: MAX_STREAM_EVIDENCE_BYTES_PER_RUN,
      });
      state.emittedBytes = MAX_STREAM_EVIDENCE_BYTES_PER_RUN;
    }
    return;
  }
  state.emittedBytes += envelopeBytes;

  enqueueLlmEvidence(state, envelope, action, context);
}

function enqueueLlmEvidence(
  state: LlmEvidenceState,
  envelope: ReturnType<typeof AuditEnvelope.parse>,
  action: string,
  context: LlmAuditContext
): void {
  const auditPort = state.auditPort;
  state.pending = state.pending
    .then(async () => await auditPort.emit(envelope))
    .catch(error => {
      logger.error('[UnifiedAudit] LLM evidence 写入失败', {
        action,
        conversationId: context.conversationId,
        runId: context.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function createLlmEvidenceEnvelope(params: {
  readonly context: LlmAuditContext;
  readonly action: string;
  readonly evidenceKind: string;
  readonly payload: unknown;
  readonly modelId?: string;
  readonly traceId?: string;
}): ReturnType<typeof AuditEnvelope.parse> | undefined {
  const projected = projectLlmEvidenceValue(params.payload, params.evidenceKind);
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
          kind: params.evidenceKind,
          metadata: projected,
        },
      ],
      scope: {
        conversationId,
        runId,
        ...((params.traceId ?? params.context.traceId)
          ? { traceId: params.traceId ?? params.context.traceId }
          : {}),
        ...(params.modelId ? { modelId: params.modelId } : {}),
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
    logger.error('[UnifiedAudit] LLM evidence 未通过合同校验', {
      action: params.action,
      conversationId: params.context.conversationId,
      runId: params.context.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function projectLlmEvidenceValue(value: unknown, stage: string): unknown | undefined {
  try {
    const projected = projectDurableLlmAuditValue(value);
    const serialized = JSON.stringify(projected);
    if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_STREAM_EVIDENCE_BYTES) {
      logger.warn('[UnifiedAudit] LLM evidence 单片段超过大小上限，已丢弃', {
        stage,
        maxBytes: MAX_STREAM_EVIDENCE_BYTES,
      });
      return undefined;
    }
    return projected;
  } catch (error) {
    logger.error('[UnifiedAudit] 拒绝不满足 durable 合同的 LLM evidence', {
      stage,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function mergeLlmAuditContext(
  parent: LlmAuditContext | undefined,
  patch: Partial<LlmAuditContext>
): LlmAuditContext | undefined {
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

function isChildRun(context: LlmAuditContext): boolean {
  return Boolean(context.subrunId?.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
