/**
 * Linnya Audit Domain 的唯一公共入口。
 *
 * 业务 host、command、inference 和 agent runner 不应直接拼装自己的 audit sink，
 * 也不应直接读取 response/stream evidence feature 的 persistence 实现。
 */
export { AuditLevelSchema, DEFAULT_AUDIT_LEVEL, type AuditLevel } from './definitions/auditLevel';
export {
  AGENT_RUN_AUDIT_RETENTION_DAYS,
  AGENT_RUN_AUDIT_RETENTION_MS,
} from './definitions/auditRetention';
export { resolveAuditLevel } from './functions/resolveAuditLevel';
export {
  createLinnyaAuditRuntime,
  type CreateLinnyaAuditRuntimeOptions,
  type LinnyaAuditRuntime,
} from './orchestration/createLinnyaAuditRuntime';

export {
  flushLinnyaAudit,
  getCurrentLlmAuditContext,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordBeforeContextManager,
  recordLlmInputMaterializationEvidence,
  recordLlmResponseSummary,
  recordLlmStreamEvent,
  recordRunTranscript,
  recordToolProtocolError,
  runWithLlmAuditContext,
} from './features/llm-evidence';
export { resetLlmAuditForTest } from './features/llm-evidence';
export type {
  LlmAuditContext,
  LlmInputMaterializationAuditInput,
  LlmResponseAuditSummaryInput,
  LlmStreamAuditEvent,
  LlmStreamAuditEventInput,
  RunTranscriptAuditToolset,
} from './features/llm-evidence';
export { projectCanonicalInferenceStreamAuditEvent } from './features/llm-evidence';

export {
  COMMAND_EXECUTION_AUDIT_ACTOR,
  CommandExecutionAuditEventSchema,
  CommandExecutionAuditRuntimeSummarySchema,
  deriveCommandExecutionAuditEnvelopeId,
  parseCommandExecutionAuditEvent,
  projectCommandExecutionAuditEnvelope,
  projectCommandExecutionAuditRuntimeSummary,
} from './features/command-execution-audit';
export type {
  CommandExecutionAuditEvent,
  CommandExecutionAuditPort,
  CommandExecutionAuditRuntimeSummary,
  ProjectCommandExecutionAuditEnvelopeInput,
} from './features/command-execution-audit';
