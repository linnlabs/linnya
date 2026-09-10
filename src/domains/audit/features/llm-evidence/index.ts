/**
 * LLM response/stream evidence 的内部绑定。
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
} from './orchestration/llmEvidenceContext';

export type {
  LlmAuditContext,
  LlmInputMaterializationAuditInput,
  LlmResponseAuditSummaryInput,
  LlmStreamAuditEvent,
  LlmStreamAuditEventInput,
  RunTranscriptAuditToolset,
} from './definitions/llmEvidence';
export { projectCanonicalInferenceStreamAuditEvent } from './functions/projectCanonicalInferenceStreamAuditEvent';
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
} from './orchestration/llmEvidenceContext';

export { configureLlmEvidence, resetLlmAuditForTest } from './orchestration/llmEvidenceContext';

setLlmAuditRecorder({
  recordBeforeContextManager,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordToolProtocolError,
  recordRunTranscript,
});
