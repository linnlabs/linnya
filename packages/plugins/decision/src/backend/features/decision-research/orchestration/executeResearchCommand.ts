import { DocumentObservationUnavailableError } from '@plugin/backend/childRunDelivery';
import { randomUUID } from 'node:crypto';
import type { PluginSqliteDatabasePort } from '@plugin/backend/toolRuntime';
import type { PluginChildRunDeliveryReader } from '@plugin/backend/childRunDelivery';
import { createDecisionRecordRepository } from '../../decision-record';
import { createResearchJobRepository } from '../persistence/researchJobRepository';
import type { ResearchCommand, ResearchCommandResult } from '../definitions/researchCommand';
import { buildResearchJob, requireDecisionRevision, requireReceivingConversation, selectResearchDelivery, collectResearchDocumentRefs, documentObservationChanged, projectResearchJob } from '../functions/researchJobRules';

export async function executeResearchCommand(command: ResearchCommand, context: {
  db: PluginSqliteDatabasePort; projectId: string; conversationId: string; runId: string;
  reader: PluginChildRunDeliveryReader; signal: AbortSignal;
}): Promise<ResearchCommandResult> {
  const records = createDecisionRecordRepository(context.db, context.projectId);
  const jobs = createResearchJobRepository(context.db, context.projectId);
  const observe = context.reader.observeDocument;
  if (command.kind === 'research_list') return { requests: jobs.list(command.id) };
  if (command.kind === 'research_prepare') {
    const record = records.read(command.id);
    requireDecisionRevision(record, command.expectedRevision);
    const materials = await Promise.all(command.scope.materials.map(observe));
    const job = buildResearchJob({ record, scope: command.scope, materials,
      id: randomUUID(), conversationId: context.conversationId, runId: context.runId, createdAt: Date.now() });
    context.signal.throwIfAborted();
    context.db.transaction(() => {
      requireDecisionRevision(records.read(record.id), record.revision);
      jobs.insert(job);
    }).immediate();
    return { request: job, subagent_type: 'decision_research', prompt: job.prompt, status: 'prepared' };
  }
  let job = jobs.read(command.id);
  if (command.kind === 'research_receive' && !job.delivery) {
    requireReceivingConversation(job, context.conversationId);
    const matched = selectResearchDelivery(job, context.reader.read(job.runId));
    const documents = await Promise.all(collectResearchDocumentRefs(matched).map(observe));
    job = { ...job, delivery: { toolCallId: matched.toolCallId, result: matched.result, children: [...matched.children], documents, observedAt: Date.now() } };
    context.signal.throwIfAborted();
    jobs.receive(job);
  }
  const lifecycle = await context.reader.readRunStatus(job.runId);
  const current = records.read(job.decisionId);
  const watched = [...job.materials, ...(job.delivery?.documents ?? [])];
  const changedDocuments: string[] = [];
  for (const old of watched) {
    try {
      const now = await observe(old.inode);
      if (documentObservationChanged(old, now)) changedDocuments.push(old.inode);
    } catch (error: unknown) {
      if (!(error instanceof DocumentObservationUnavailableError)) throw error;
      // 已接回结果仍须保留；材料删除或无权读取是失效事实，不伪造内容或替代版本。
      changedDocuments.push(old.inode);
    }
  }
  return projectResearchJob(job, current.inputRevision, lifecycle, changedDocuments);
}
