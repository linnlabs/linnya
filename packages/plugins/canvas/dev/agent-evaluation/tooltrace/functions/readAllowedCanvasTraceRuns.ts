import type { z } from 'zod';
import { ConversationControlAuditResponseSchema } from '@app/schemas';
import type { CanvasTraceScope } from '../definitions/canvasToolTrace';

const auditScope = ConversationControlAuditResponseSchema.pick({
  schema_version: true,
  command: true,
  ok: true,
  conversation_id: true,
  requested_run_id: true,
  completeness: true,
  runs: true,
}).strip();
/** 独立续轮只按可信send明确列入；同一会话中其他root不能借audit全量列表混入。 */
export function readAllowedCanvasTraceRuns(input: {
  readonly scope: CanvasTraceScope;
  readonly audit: unknown;
  readonly continuationAudits?: readonly unknown[];
}) {
  const roots = [input.scope.rootRunId, ...(input.scope.continuationRunIds ?? [])],
    values = [input.audit, ...(input.continuationAudits ?? [])];
  if (values.length !== roots.length || new Set(roots).size !== roots.length) return;
  const runs: z.infer<typeof auditScope>['runs'] = [];
  for (const [index, value] of values.entries()) {
    const parsed = auditScope.safeParse(value),
      root = roots[index];
    if (
      !parsed.success ||
      parsed.data.conversation_id !== input.scope.conversationId ||
      parsed.data.requested_run_id !== root ||
      !parsed.data.runs.some(run => run.run_id === root) ||
      parsed.data.completeness.run_registry !== 'complete' ||
      parsed.data.completeness.event_store !== 'complete'
    )
      return;
    runs.push(...parsed.data.runs);
  }
  const allowed = new Set(roots);
  for (let changed = true; changed; ) {
    changed = false;
    for (const run of runs)
      if (run.parent_run_id && allowed.has(run.parent_run_id) && !allowed.has(run.run_id)) {
        allowed.add(run.run_id);
        changed = true;
      }
  }
  return allowed;
}
