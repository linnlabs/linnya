import type {
  ExecutionAuditEventFact,
  ExecutionAuditExport,
  ExecutionAuditWorkspaceDocumentObservation,
} from '../definitions/executionAuditExport';

export function summarizeWorkspaceDocumentDiagnostics(
  facts: readonly ExecutionAuditEventFact[],
): ExecutionAuditExport['workspaceDocuments'] {
  const byObservation: ExecutionAuditWorkspaceDocumentObservation[] = [];
  const visible = { error: 0, warning: 0, info: 0 };
  let truncatedCount = 0;
  for (const fact of facts) {
    if (fact.kind !== 'tool_terminal' || !fact.workspaceDocument) continue;
    const observed = { error: 0, warning: 0, info: 0 };
    for (const severity of fact.workspaceDocument.severities) {
      observed[severity] += 1;
      visible[severity] += 1;
    }
    truncatedCount += fact.workspaceDocument.truncatedCount;
    byObservation.push({
      runId: fact.runId,
      ...(fact.parentRunId ? { parentRunId: fact.parentRunId } : {}),
      toolCallId: fact.toolCallId,
      toolName: fact.workspaceDocument.toolName,
      emittedAt: fact.emittedAt,
      visible: observed,
      truncatedCount: fact.workspaceDocument.truncatedCount,
    });
  }
  // 这是写入时的诊断观测，不去重为“文档当前剩余问题”，也不推断截断项严重度。
  return {
    observations: byObservation.length,
    observationsWithErrors: byObservation.filter(item => item.visible.error > 0).length,
    observationsWithWarnings: byObservation.filter(item => item.visible.warning > 0).length,
    visible,
    truncatedCount,
    byObservation: byObservation.sort((left, right) => left.emittedAt - right.emittedAt),
  };
}
