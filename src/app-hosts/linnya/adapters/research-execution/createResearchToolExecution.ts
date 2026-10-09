import type { ResearchRunArgs, ResearchRunData } from '@app/schemas';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import type { ToolContext } from 'src/tools/types';
import { runRegisteredSubagent } from 'src/tools/agent_control/subrun/shared';
import { derivePluginAwareToolContext } from '../../plugin-registry/toolContextDerivation';
import { createResearchUseCase, type ResearchExecutionIdentity } from '../../application/research';
import { createWorkspaceResearchDocumentPort } from '../research-documents';
import { SQLiteEventStore } from '../persistence/event-store';
import { SqliteResearchStageReceiptStore } from '../persistence/research-stage-receipts';

export function createResearchToolExecution(context: ToolContext): (input: ResearchRunArgs) => Promise<ResearchRunData> {
  const { databaseService, runId, parentToolCallId, conversationId, workspaceProjectId, modelId } = context;
  if (!databaseService || !runId || !parentToolCallId || !conversationId || !workspaceProjectId || !modelId) {
    throw new Error('Research requires a durable run, tool call, project, conversation, database and selected model');
  }
  const identity: ResearchExecutionIdentity = { parentRunId: runId, toolCallId: parentToolCallId,
    conversationId, projectId: workspaceProjectId, modelId };
  const db = databaseService.getDb();
  const useCase = createResearchUseCase({
    documents: createWorkspaceResearchDocumentPort({ db, eventStore: new SQLiteEventStore(db),
      workspaceService: context.workspaceService ?? new WorkspaceService(db, { mutationPublisher: context.workspaceMutationPublisher }) }),
    receipts: new SqliteResearchStageReceiptStore(db),
    children: {
      async execute(stage, owner, signal) {
        // 子运行恢复依然使用同一冻结 stage；该字段不是模型参数，不可由工具调用开放检索。
        const childContext = derivePluginAwareToolContext(context, {
          researchRetrievalAllowed: stage.invocation.task_type !== 'fixed', abortSignal: signal,
        });
        const result = await runRegisteredSubagent({
          context: childContext, promptKey: stage.request.promptKey,
          description: stage.stage, userMessage: stage.request.query, inheritTurns: 0,
          maxSteps: 800, modelId: owner.modelId, subrunId: stage.subrunId,
          subrunSource: 'research_run', subrunMetadata: { stage: stage.stage },
        });
        signal?.throwIfAborted();
        if (result.cancelled) throw new DOMException('Research stage cancelled', 'AbortError');
        if (!result.success || !result.runId) throw new Error(result.error ?? `Research stage ${stage.stage} failed`);
        return { sourceRunId: result.runId, text: result.finalAnswer };
      },
    },
  });
  return input => useCase.execute(input, identity, context.abortSignal);
}
