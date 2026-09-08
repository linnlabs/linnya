/**
 * Linnya Audit Domain 的唯一公共入口。
 *
 * 业务 host、command、inference 和 agent runner 不应直接拼装自己的 audit sink，
 * 也不应直接读取 llm-debug-evidence 的 persistence 实现。
 */
export { AuditLevelSchema, DEFAULT_AUDIT_LEVEL, type AuditLevel } from './definitions/auditLevel';
export { resolveAuditLevel } from './functions/resolveAuditLevel';
export {
  createLinnyaAuditRuntime,
  type CreateLinnyaAuditRuntimeOptions,
  type LinnyaAuditRuntime,
} from './orchestration/createLinnyaAuditRuntime';

export {
  DEBUG_EVIDENCE_MAX_DIRECTORY_BYTES,
  DEBUG_EVIDENCE_MAX_RUN_FILE_BYTES,
  DEBUG_EVIDENCE_RETENTION_DAYS,
} from './features/debug-evidence';

export {
  flushLinnyaAudit,
  getCurrentLLMDebugEvidenceContext,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordBeforeContextManager,
  recordLlmInputMaterializationEvidence,
  recordRunTranscript,
  recordToolProtocolError,
  runWithLLMDebugEvidenceContext,
} from './features/llm-debug-evidence';
export { resetLlmDebugEvidenceForTest } from './features/llm-debug-evidence';
export type {
  LLMDebugEvidenceContext,
  LlmInputMaterializationDebugEvidenceInput,
  RunTranscriptDebugEvidenceToolset,
} from './features/llm-debug-evidence';

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
