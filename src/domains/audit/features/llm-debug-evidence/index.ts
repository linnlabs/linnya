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
} from './orchestration/llmDebugEvidenceContext';

export type {
  LLMDebugEvidenceContext,
  LlmInputMaterializationDebugEvidenceInput,
  RunTranscriptDebugEvidenceToolset,
} from './definitions/llmDebugEvidence';
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
} from './orchestration/llmDebugEvidenceContext';

export { configureLlmDebugEvidence, resetLlmDebugEvidenceForTest } from './orchestration/llmDebugEvidenceContext';

setLlmAuditRecorder({
  recordBeforeContextManager,
  recordAfterContextManager,
  recordAfterContextManagerOnSystemReminderHit,
  recordToolProtocolError,
  recordRunTranscript,
});
