import type {
  ResearchExecutionIdentity,
  ResearchStageReceipt,
} from '../../../../application/research/definitions/researchStageReceipt';
import {
  PreparedResearchStageStorageSchema,
  ResearchDocumentBindingStorageSchema,
  ResearchStageReceiptRowSchema,
} from '../definitions/researchStageReceiptStorage';

export function readResearchStageReceipt(
  value: unknown,
  identity: ResearchExecutionIdentity
): ResearchStageReceipt {
  const row = ResearchStageReceiptRowSchema.parse(value);
  if (
    row.parent_run_id !== identity.parentRunId ||
    row.tool_call_id !== identity.toolCallId ||
    row.project_id !== identity.projectId ||
    row.conversation_id !== identity.conversationId ||
    row.model_id !== identity.modelId
  ) {
    throw new Error('Research stage receipt execution identity differs from its frozen admission.');
  }
  const prepared = PreparedResearchStageStorageSchema.parse(JSON.parse(row.prepared_json));
  if ('runId' in prepared && prepared.runId !== identity.parentRunId)
    throw new Error('Research parent document must belong to its admitted parent run.');
  if (prepared.stage !== row.stage)
    throw new Error('Research stage receipt row identity mismatch.');
  if (row.artifact_json === null) return prepared;
  const artifact = ResearchDocumentBindingStorageSchema.parse(JSON.parse(row.artifact_json));
  if (artifact.locator !== prepared.outputPath)
    throw new Error('Research stage artifact path differs from its prepared output.');
  return { ...prepared, artifact };
}
