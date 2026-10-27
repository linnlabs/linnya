import type { ResearchRunArgs } from '@app/schemas';
import type { PluginChildRunDelivery, PluginChildRunStatus, PluginDocumentObservation } from '@plugin/backend/childRunDelivery';
import type { DecisionRecord } from '../../../../shared';
import { DecisionFailure } from '../../decision-record';
import type { ResearchJob } from '../definitions/researchJob';
import type { ResearchCommandResult } from '../definitions/researchCommand';

export function requireDecisionRevision(record: DecisionRecord, expected: number): void {
  if (record.revision !== expected) throw new DecisionFailure('revision_conflict', 'Decision changed. Read the current record before preparing research.');
}
export function requireReceivingConversation(job: ResearchJob, conversationId: string): void {
  if (job.conversationId !== conversationId) throw new DecisionFailure('invalid_model', 'Receive this request in its originating conversation.');
}
export function buildResearchJob(input: {
  record: DecisionRecord; scope: ResearchRunArgs; materials: PluginDocumentObservation[];
  id: string; conversationId: string; runId: string; createdAt: number;
}): ResearchJob {
  if (input.materials.some(item => item.pendingCount > 0)) throw new DecisionFailure('invalid_model', 'Accept or reject pending material edits before preparing research.');
  const { record } = input;
  const scope = { ...input.scope, question: `${input.scope.question}\n\nDecision input snapshot (provided conditions, not new evidence):\n${JSON.stringify({ decisionId: record.id, inputRevision: record.inputRevision, model: record.model })}` };
  return {
    id: input.id, decisionId: record.id, inputRevision: record.inputRevision, decisionRevision: record.revision,
    conversationId: input.conversationId, runId: input.runId, scope,
    prompt: JSON.stringify({ request_id: input.id, scope }), materials: input.materials, createdAt: input.createdAt,
  };
}
export function selectResearchDelivery(job: ResearchJob, deliveries: readonly PluginChildRunDelivery[]): PluginChildRunDelivery {
  const matches = deliveries.filter(item => item.type === 'decision_research' && item.prompt === job.prompt);
  const [matched, additional] = matches;
  if (!matched) throw new DecisionFailure('invalid_model', 'No committed subagent delivery for this request. Continue the original managed run; do not paste a result.');
  if (additional) throw new DecisionFailure('invalid_model', 'This request was launched more than once. Inspect the calls; no result is selected automatically.');
  return matched;
}
/** 包含协调者及直接评审的正式文档；不从最终回答里的路径猜产物。 */
export function collectResearchDocumentRefs(delivery: Pick<PluginChildRunDelivery, 'result' | 'children'>): string[] {
  return [...new Set([delivery.result, ...delivery.children].flatMap(result => result.artifacts)
    .filter(ref => ref.startsWith('workspace:')))];
}
export function documentObservationChanged(old: PluginDocumentObservation, now: PluginDocumentObservation): boolean {
  return now.versionNumber !== old.versionNumber || now.pendingCount !== old.pendingCount || now.sha256 !== old.sha256;
}
export function projectResearchJob(
  job: ResearchJob, inputRevision: number, lifecycle: PluginChildRunStatus | null, changedDocuments: string[],
): Extract<ResearchCommandResult, { lifecycle: PluginChildRunStatus | null }> {
  const changedInputs = inputRevision !== job.inputRevision;
  const reviewsComplete = ['research_argument_review', 'research_source_review'].every(type =>
    job.delivery?.children.some(child => child.subagent_type === type && child.status === 'completed' && child.artifacts.some(ref => ref.startsWith('workspace:'))));
  const hasOutputs = job.delivery?.result.artifacts.some(ref => ref.startsWith('workspace:')) === true;
  // 接回早期原型产生的旧记录时不补造当时版本；缺失观察明确保留为待复核。
  const unobservedDocuments = job.delivery ? collectResearchDocumentRefs(job.delivery)
    .filter(ref => !job.delivery?.documents.some(document => document.inode === ref)) : [];
  let status: Extract<ResearchCommandResult, { lifecycle: PluginChildRunStatus | null }>['status'];
  if (!job.delivery) status = lifecycle === 'cancelled' || lifecycle === 'failed' || lifecycle === 'paused'
    ? lifecycle : lifecycle === 'completed' ? 'not_delivered' : 'awaiting_delivery';
  else if (job.delivery.result.status !== 'completed') status = job.delivery.result.status;
  else if (!reviewsComplete || !hasOutputs) status = 'partial';
  else status = changedInputs || changedDocuments.length > 0 || unobservedDocuments.length > 0 ? 'needs_review' : 'received';
  return {
    request: job, status, lifecycle, reviewsComplete, changedInputs, unobservedDocuments, changedDocuments: [...new Set(changedDocuments)],
    note: 'Versions are observed at preparation/receipt. Received is execution/version association, not correctness certification. No recommendation was changed.',
  };
}
