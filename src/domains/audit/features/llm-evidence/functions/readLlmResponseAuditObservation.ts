import type { AuditEnvelope } from '@linnlabs/linnkit/contracts';
import {
  LlmResponseAuditSummarySchema,
  type LlmResponseAuditObservation,
} from '../definitions/llmResponseAudit';

/** Audit owner 的只读白名单投影，调用方不接触模型正文、route 或任意 metadata。 */
export function readLlmResponseAuditObservation(
  envelope: AuditEnvelope,
): LlmResponseAuditObservation | null {
  if (envelope.action !== 'llm.response.succeeded' && envelope.action !== 'llm.response.failed') {
    return null;
  }
  const evidence = envelope.evidence?.filter(item => item.kind === 'llm_response_summary') ?? [];
  if (evidence.length !== 1) throw new Error('[Audit] LLM response 必须有唯一摘要事实。');
  const summary = LlmResponseAuditSummarySchema.parse(evidence[0]?.metadata);
  if (envelope.action !== `llm.response.${summary.outcome}`) {
    throw new Error('[Audit] LLM response action 与摘要终态不一致。');
  }
  const common = {
    envelopeId: envelope.envelopeId,
    emittedAt: envelope.ts,
    attemptId: summary.attemptId,
    traceId: summary.traceId,
    modelId: summary.modelId,
  };
  return summary.outcome === 'failed'
    ? { ...common, outcome: summary.outcome, failure: summary.failure }
    : { ...common, outcome: summary.outcome };
}
