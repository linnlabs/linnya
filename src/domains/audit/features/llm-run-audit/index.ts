/**
 * LLM run audit 的唯一公共入口。
 *
 * 审计上下文仅服务本地观测，禁止进入模型供应商请求体或请求头。
 */
import { setLlmAuditRecorder } from 'linnkit';
import {
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordBeforeContextManager,
  recordRunTranscript,
  recordToolProtocolError,
} from './orchestration/llmRunAuditContext';

export type {
  ContextManagerAuditEntry,
  ContextManagerAuditStage,
  LLMAuditContext,
  LlmInputMaterializationAuditEntry,
  LlmInputMaterializationAuditInput,
  RunTranscriptAuditEntry,
  ToolProtocolErrorAuditEntry,
  ToolProtocolErrorReplayInput,
} from './definitions/llmRunAudit';
export {
  flushRunContextManagerAuditToDisk,
  getCurrentLLMAuditContext,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordBeforeContextManager,
  recordLlmInputMaterializationEvidence,
  recordRunTranscript,
  recordToolProtocolError,
  runWithLLMAuditContext,
} from './orchestration/llmRunAuditContext';

setLlmAuditRecorder({
  recordBeforeContextManager,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordToolProtocolError,
  recordRunTranscript,
});
