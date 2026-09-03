import type { ToolControlInfo } from '../../tools/ui-types';
import type { UnknownRecord } from './toolNode.helpers';
import { isRecord } from './toolNode.helpers';
import { parseRuntimeEvents, type RuntimeEvent, type ToolCallId } from '../../../contracts';
import {
  parseToolModelInputDeclaration,
  type ToolModelInputAttachmentSelection,
} from '../../tools/model-input';

function mergeHistory(local: UnknownRecord, runtimeEvents: RuntimeEvent[]): RuntimeEvent[] {
  const history = parseRuntimeEvents(local.history ?? []);
  return [...history, ...runtimeEvents];
}

export function stripAnswerState(local: UnknownRecord): UnknownRecord {
  const nextLocal = { ...local };
  delete nextLocal.answerId;
  delete nextLocal.chunkSeq;
  return nextLocal;
}

export function readStructuredObservation(parsed: unknown): string | undefined {
  return isRecord(parsed) && typeof parsed.observation === 'string'
    ? parsed.observation
    : undefined;
}

export type StructuredToolResultContractValidation =
  | {
      readonly ok: true;
      readonly result: UnknownRecord;
      readonly observation: string;
      readonly modelInputAttachments?: readonly ToolModelInputAttachmentSelection[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

/**
 * Agent 工具的成功结果必须严格分离 UI data 与模型 observation。
 * 这里校验可观察的协议形状，不猜测业务字段，也不修补工具返回值。
 */
export function validateStructuredToolResultContract(
  parsed: unknown
): StructuredToolResultContractValidation {
  if (!isRecord(parsed)) {
    return { ok: false, reason: '工具成功结果必须是 JSON 对象。' };
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'data') || parsed.data === undefined) {
    return { ok: false, reason: '工具成功结果缺少必填字段 data。' };
  }
  if (typeof parsed.observation !== 'string' || parsed.observation.trim().length === 0) {
    return { ok: false, reason: '工具成功结果缺少非空字符串 observation。' };
  }
  if (parsed.modelInput !== undefined) {
    const modelInput = parseToolModelInputDeclaration(parsed.modelInput);
    if (!modelInput.ok) {
      return { ok: false, reason: modelInput.reason };
    }
    return {
      ok: true,
      result: parsed,
      observation: parsed.observation,
      modelInputAttachments: modelInput.declaration.attachments,
    };
  }
  return {
    ok: true,
    result: parsed,
    observation: parsed.observation,
  };
}

export function extractToolControlInfo(parsed: unknown): ToolControlInfo | undefined {
  if (!isRecord(parsed) || !isRecord(parsed.control)) {
    return undefined;
  }

  const control = parsed.control;
  const requireUser = control.requireUser === true;
  const terminateRun = control.terminateRun === true;
  const finalAnswer =
    typeof control.finalAnswer === 'string' && control.finalAnswer.trim().length > 0
      ? control.finalAnswer
      : undefined;
  if (!requireUser && !terminateRun && !finalAnswer) {
    return undefined;
  }

  return {
    ...(requireUser ? { requireUser: true } : {}),
    ...(typeof control.questionnaireId === 'string'
      ? { questionnaireId: control.questionnaireId }
      : {}),
    ...(control.resumeStrategy === 'continue' ? { resumeStrategy: 'continue' } : {}),
    ...(terminateRun ? { terminateRun: true } : {}),
    ...(finalAnswer ? { finalAnswer } : {}),
    ...(typeof control.reason === 'string' ? { reason: control.reason } : {}),
  };
}

export function applyToolOutputIdempotencyMetadata(params: {
  runtimeToolOutput: RuntimeEvent | null;
  execIdempotency?: { key: string; cacheHit: boolean };
}): void {
  if (!params.runtimeToolOutput || !params.execIdempotency) {
    return;
  }

  if (params.execIdempotency.cacheHit) {
    params.runtimeToolOutput.ephemeral = true;
  }

  params.runtimeToolOutput.metadata = {
    ...(params.runtimeToolOutput.metadata ?? {}),
    idempotency: {
      key: params.execIdempotency.key,
      cache_hit: params.execIdempotency.cacheHit,
    },
  };
}

export function buildRequireUserLocalState(params: {
  local: UnknownRecord;
  parsed: unknown;
  toolCallId: ToolCallId;
  toolName: string;
  remainingCalls: unknown[];
  conversationId: string;
  turnId: string;
  runtimeEvents: RuntimeEvent[];
}): UnknownRecord {
  return {
    ...params.local,
    pendingToolCalls: params.remainingCalls,
    pendingInteractionSpec: {
      ...(isRecord(params.parsed) && isRecord(params.parsed.control) ? params.parsed.control : {}),
      // wait_user 必须携带工具已校验的结构化结果，UI 才能使用正式 form identity。
      form: params.parsed,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
    },
    lastToolResult: params.parsed as unknown,
    conversationId: params.conversationId,
    turnId: params.turnId,
    history: mergeHistory(params.local, params.runtimeEvents),
  };
}

export function buildSuccessLocalState(params: {
  local: UnknownRecord;
  remainingCalls: unknown[];
  conversationId: string;
  turnId: string;
  runtimeEvents: RuntimeEvent[];
}): UnknownRecord {
  return {
    ...stripAnswerState(params.local),
    pendingToolCalls: params.remainingCalls,
    conversationId: params.conversationId,
    turnId: params.turnId,
    history: mergeHistory(params.local, params.runtimeEvents),
  };
}

export function buildErrorLocalState(params: {
  local: UnknownRecord;
  remainingCalls: unknown[];
  conversationId: string;
  turnId: string;
  runtimeEvents: RuntimeEvent[];
  nextProtocolErrorCount: number;
}): UnknownRecord {
  const nextLocal: UnknownRecord = {
    ...stripAnswerState(params.local),
    pendingToolCalls: params.remainingCalls,
    conversationId: params.conversationId,
    turnId: params.turnId,
    history: mergeHistory(params.local, params.runtimeEvents),
  };

  if (params.nextProtocolErrorCount > 0) {
    nextLocal._consecutiveToolProtocolErrors = params.nextProtocolErrorCount;
  } else {
    delete nextLocal._consecutiveToolProtocolErrors;
  }

  return nextLocal;
}
