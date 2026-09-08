/**
 * LLM debug evidence 的内部绑定。
 *
 * 这个 feature 不拥有 sink；它把 Linnkit 的 LLM 观测回调绑定到 Audit Domain
 * 当前配置的 AuditPort。宿主只能通过 `src/domains/audit` 的公共入口使用它。
 */
import { setLlmAuditRecorder } from '@linnlabs/linnkit';
import {
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordBeforeContextManager,
  recordRunTranscript,
  recordToolProtocolError,
} from './orchestration/llmRunAuditContext';

export type {
  LLMAuditContext,
  LlmInputMaterializationAuditInput,
  RunTranscriptAuditToolset,
} from './definitions/llmRunAudit';
export {
  flushLinnyaAudit,
  getCurrentLLMAuditContext,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordBeforeContextManager,
  recordLlmInputMaterializationEvidence,
  recordRunTranscript,
  recordToolProtocolError,
  runWithLLMAuditContext,
} from './orchestration/llmRunAuditContext';

export { configureLlmRunAudit, resetLlmRunAuditForTest } from './orchestration/llmRunAuditContext';

setLlmAuditRecorder({
  recordBeforeContextManager,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordToolProtocolError,
  recordRunTranscript,
});
