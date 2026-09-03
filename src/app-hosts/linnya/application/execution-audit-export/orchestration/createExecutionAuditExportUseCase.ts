import type {
  ExecutionAuditExportPorts,
  ExecutionAuditExportUseCase,
} from '../definitions/executionAuditExport';
import { selectExecutionAuditScope } from '../functions/selectExecutionAuditScope';
import { summarizeExecutionAudit } from '../functions/summarizeExecutionAudit';

export function createExecutionAuditExportUseCase(
  ports: ExecutionAuditExportPorts,
): ExecutionAuditExportUseCase {
  return {
    async export(request) {
      const [runs, telemetry, eventFacts] = await Promise.all([
        ports.runs.listByConversation(request.conversationId),
        ports.telemetry.listByConversation(request.conversationId),
        ports.events.listByConversation(request.conversationId),
      ]);
      const scope = selectExecutionAuditScope(runs, telemetry, eventFacts, request.runId);
      if (!scope) return null;
      return summarizeExecutionAudit({
        generatedAt: ports.now(),
        runs: scope.runs,
        telemetry: scope.telemetry,
        eventFacts: scope.eventFacts,
      });
    },
  };
}
