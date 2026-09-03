/**
 * Runtime 身份生成器的唯一实现。
 *
 * 每个函数只创建名称对应的实体身份。调用点必须选择真实业务身份，禁止用某个
 * “通用 message ID”代替 event、tool call、interaction 等不同实体。完整 UUID
 * 保留足够的全局唯一性；前缀只用于诊断，不承担类型判断。
 */

import {
  RunIdSchema,
  ToolCallIdSchema,
  type RunId,
  type SubrunId,
  type ToolCallId,
  type TurnId,
} from './definitions';

function randomIdentity(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Runtime identity generation requires globalThis.crypto.randomUUID.');
  }
  return `${prefix}-${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
}

export function generateRuntimeEventId(): string {
  return randomIdentity('evt');
}

export function generateAiMessageId(): string {
  return randomIdentity('aimsg');
}

export function generateAnswerSegmentId(): string {
  return randomIdentity('answer');
}

export function generateConversationId(): string {
  return randomIdentity('conv');
}

export function generateTurnId(): string {
  return randomIdentity('turn');
}

export function generateRunId(): RunId {
  return RunIdSchema.parse(randomIdentity('run'));
}

export function generateExecutionId(): string {
  return randomIdentity('exec');
}

export function generateTraceId(): string {
  return randomIdentity('trace');
}

export function generateInferenceAttemptId(): string {
  return randomIdentity('inference-attempt');
}

export function generateThoughtMessageId(): string {
  return randomIdentity('thought');
}

export function generateToolCallId(): ToolCallId {
  return ToolCallIdSchema.parse(randomIdentity('call'));
}

export function generateInteractionId(): string {
  return randomIdentity('interaction');
}

export function generateResumeToken(): string {
  return randomIdentity('resume');
}

export function generateSubrunId(): string {
  return randomIdentity('subrun');
}

export function generateRunResumeClaimId(): string {
  return randomIdentity('resume-claim');
}

export function generateAuditEnvelopeId(): string {
  return randomIdentity('audit');
}

export function generateContextLedgerEntryId(): string {
  return randomIdentity('context-ledger');
}

/** Host-only 持久化沿用 turn identity 时，显式建立其 Run 身份语义。 */
export function runIdFromTurnId(turnId: TurnId): RunId {
  return RunIdSchema.parse(turnId);
}

/** Child run 沿用 subrun identity 时，显式建立其 Run 身份语义。 */
export function runIdFromSubrunId(subrunId: SubrunId): RunId {
  return RunIdSchema.parse(subrunId);
}
