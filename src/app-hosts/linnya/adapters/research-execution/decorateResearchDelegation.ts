import {
  RESEARCH_AGENT_ID,
  ResearchRunArgsSchema,
  SubmitResearchDocumentResultSchema,
  SubagentArtifactRefSchema,
} from '@app/schemas';
import { runIdFromSubrunId } from '@linnlabs/linnkit/contracts';
import type { ToolContext } from 'src/tools/types';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  createResearchDelegationUseCase,
  researchDelegationStage,
  type ResearchExecutionIdentity,
} from '../../application/research';
import { createWorkspaceResearchDocumentPort } from '../research-documents';
import { SQLiteEventStore } from '../persistence/event-store';
import { SQLiteRunRegistryStore } from '../persistence/run-registry';
import { SqliteRunDescriptorStore } from '../persistence/run-descriptors';
import { SqliteResearchStageReceiptStore } from '../persistence/research-stage-receipts';
import { bindResearchStageSubmission } from './bindResearchStageSubmission';

/** 装配研究交接能力；子运行启动仍由通用 subagent 工具唯一负责。 */
export async function decorateResearchDelegation(context: ToolContext): Promise<void> {
  if (context.callerAgentId !== RESEARCH_AGENT_ID) return;
  const { databaseService, runId, parentToolCallId, conversationId, workspaceProjectId, modelId } =
    context;
  if (
    !databaseService ||
    !runId ||
    !parentToolCallId ||
    !conversationId ||
    !workspaceProjectId ||
    !modelId
  )
    throw new Error('Research delegation requires a durable project run and tool identity.');
  const db = databaseService.getDb();
  const descriptor = await new SqliteRunDescriptorStore(db).load(runId);
  if (
    !descriptor ||
    descriptor.child ||
    descriptor.request.promptKey !== RESEARCH_AGENT_ID ||
    descriptor.options?.host_tool_call
  )
    throw new Error('Research delegation requires the admitted lead Agent run.');
  const invocation = ResearchRunArgsSchema.parse(descriptor.request.researchScope);
  const identity: ResearchExecutionIdentity = {
    parentRunId: runId,
    toolCallId: parentToolCallId,
    projectId: workspaceProjectId,
    conversationId,
    modelId,
  };
  const registry = new SQLiteRunRegistryStore(db);
  const useCase = createResearchDelegationUseCase({
    documents: createWorkspaceResearchDocumentPort({
      db,
      eventStore: new SQLiteEventStore(db),
      workspaceService:
        context.workspaceService ??
        new WorkspaceService(db, { mutationPublisher: context.workspaceMutationPublisher }),
    }),
    receipts: new SqliteResearchStageReceiptStore(db),
    async childCompleted(subrunId, parentRunId) {
      const child = await registry.load(runIdFromSubrunId(subrunId));
      return child?.parentRunId === parentRunId && child.status === 'completed';
    },
  });
  context.researchRetrievalAllowed = invocation.task_type !== 'fixed';
  context.prepareSubagentTask = async request => {
    if (request.modelId !== identity.modelId)
      throw new Error('Research children must inherit the selected lead model.');
    const stage = researchDelegationStage(request.resolvedType.type);
    const { prepared, session } = await useCase.prepare({
      identity,
      invocation,
      stage,
      instructions: `${request.args.description}\n\n${request.args.prompt}`,
      documents: request.args.input_documents ?? [],
      signal: context.abortSignal,
    });
    if (request.resolvedType.promptKey !== prepared.request.promptKey)
      throw new Error('Registered research role does not match the prepared assignment.');
    const bound = bindResearchStageSubmission(
      context,
      prepared,
      identity,
      session.submit,
      context.abortSignal
    );
    return {
      context: bound.context,
      userMessage: prepared.request.query,
      subrunId: prepared.subrunId,
      async acceptResult(result) {
        bound.assertActive();
        if (!result.judgeToolOutput)
          throw new Error('Research child returned without submitting its document.');
        const artifact = SubmitResearchDocumentResultSchema.parse(
          JSON.parse(result.judgeToolOutput)
        ).data;
        await session.accept(artifact);
        return [SubagentArtifactRefSchema.parse(artifact.inode)];
      },
    };
  };
  context.researchCompletion = document =>
    useCase.complete(identity, document, context.abortSignal);
}
