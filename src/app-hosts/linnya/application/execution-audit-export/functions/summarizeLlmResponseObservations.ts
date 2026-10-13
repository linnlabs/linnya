import type {
  ExecutionAuditEventFact,
  ExecutionAuditExport,
  ExecutionAuditLlmResponseFact,
  ExecutionAuditRunRecord,
} from '../definitions/executionAuditExport';

export function summarizeLlmResponseObservations(
  runs: readonly ExecutionAuditRunRecord[],
  facts: readonly ExecutionAuditEventFact[],
): ExecutionAuditExport['llmResponses'] {
  const byRun = new Map<string, ExecutionAuditLlmResponseFact[]>();
  for (const fact of facts) {
    if (fact.kind !== 'llm_response') continue;
    const attempts = byRun.get(fact.runId) ?? [];
    attempts.push(fact);
    byRun.set(fact.runId, attempts);
  }
  return {
    byRun: runs.map(run => {
      const attempts = (byRun.get(run.runId) ?? []).sort((left, right) => (
        left.emittedAt - right.emittedAt || left.eventId.localeCompare(right.eventId)
      ));
      // 子树和父身份只由 RunRegistry 决定；不把 trace 标签或时间邻近当作关联。
      if (attempts.some(attempt => attempt.parentRunId !== run.parentRunId)) {
        throw new Error('[ExecutionAudit] LLM response 父身份与 RunRegistry 不一致。');
      }
      return {
        runId: run.runId,
        ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
        evidence: attempts.length > 0 ? 'observed' : 'unavailable',
        observedAttempts: attempts.length,
        observedFailures: attempts.filter(attempt => attempt.outcome === 'failed').length,
        attempts,
      };
    }),
  };
}
