import {
  ResearchRunArgsSchema,
  SubmitResearchDocumentResultSchema,
  type ResearchRunArgs,
  type ResearchRunData,
} from '@app/schemas';
import { runIdFromSubrunId } from '@linnlabs/linnkit/contracts';
import { ResearchInputsChangedError } from '../../application/research/definitions/researchUseCase';
import {
  ResearchSubmissionScopeError,
  serializeResearchDocumentSubmission,
} from './SubmitResearchDocumentTool';
import { isDeepStrictEqual } from 'node:util';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import type { ToolContext } from 'src/tools/types';
import { runRegisteredSubagent } from 'src/tools/agent_control/subrun/shared';
import { derivePluginAwareToolContext } from '../../plugin-registry/toolContextDerivation';
import { createResearchUseCase, type ResearchExecutionIdentity } from '../../application/research';
import { createWorkspaceResearchDocumentPort } from '../research-documents';
import { SQLiteEventStore } from '../persistence/event-store';
import { SqliteRunDescriptorStore } from '../persistence/run-descriptors';
import { SqliteResearchStageReceiptStore } from '../persistence/research-stage-receipts';

export function createResearchToolExecution(
  context: ToolContext
): (input: ResearchRunArgs) => Promise<ResearchRunData> {
  const { databaseService, runId, parentToolCallId, conversationId, workspaceProjectId, modelId } =
    context;
  if (
    !databaseService ||
    !runId ||
    !parentToolCallId ||
    !conversationId ||
    !workspaceProjectId ||
    !modelId
  ) {
    throw new Error(
      'Research requires a durable run, tool call, project, conversation, database and selected model'
    );
  }
  const identity: ResearchExecutionIdentity = {
    parentRunId: runId,
    toolCallId: parentToolCallId,
    conversationId,
    projectId: workspaceProjectId,
    modelId,
  };
  const db = databaseService.getDb();
  const useCase = createResearchUseCase({
    documents: createWorkspaceResearchDocumentPort({
      db,
      eventStore: new SQLiteEventStore(db),
      workspaceService:
        context.workspaceService ??
        new WorkspaceService(db, { mutationPublisher: context.workspaceMutationPublisher }),
    }),
    receipts: new SqliteResearchStageReceiptStore(db),
    children: {
      async execute(stage, owner, submit, signal) {
        const invalidation = new AbortController();
        const stageSignal = signal
          ? AbortSignal.any([signal, invalidation.signal])
          : invalidation.signal;
        const expectedRunId = runIdFromSubrunId(stage.subrunId);
        // 子运行恢复依然使用同一冻结 stage；该字段不是模型参数，不可由工具调用开放检索。
        const childContext = derivePluginAwareToolContext(context, {
          researchRetrievalAllowed: stage.invocation.task_type !== 'fixed',
          abortSignal: stageSignal,
          async researchDocumentSubmission(content, caller) {
            const callId = caller.parentToolCallId;
            const receipts = caller.toolResultReceipts;
            // 能力随上下文传播，但不能被同伴、嵌套网页 worker 或父模型冒用。
            if (
              caller.runId !== expectedRunId ||
              caller.conversationId !== owner.conversationId ||
              !callId ||
              !receipts
            )
              throw new ResearchSubmissionScopeError();
            try {
              return await submit({
                sourceRunId: expectedRunId,
                content,
                signal: caller.abortSignal,
                resultCommit: {
                  prepare: () => receipts.prepare(callId, 'submit_research_document'),
                  commit: artifact =>
                    receipts.commit(
                      callId,
                      'submit_research_document',
                      serializeResearchDocumentSubmission(artifact)
                    ),
                },
              });
            } catch (error) {
              // 输入失效不是可修正的 Markdown 错误；结束这个 child 的同一次执行。
              if (error instanceof ResearchInputsChangedError) invalidation.abort(error);
              throw error;
            }
          },
        });
        const result = await runRegisteredSubagent({
          context: childContext,
          promptKey: stage.request.promptKey,
          description: stage.stage,
          userMessage: stage.request.query,
          inheritTurns: 0,
          maxSteps: 800,
          modelId: owner.modelId,
          subrunId: stage.subrunId,
          subrunSource: 'research_run',
          subrunMetadata: { stage: stage.stage },
        }).catch(error => {
          if (invalidation.signal.aborted) throw invalidation.signal.reason;
          throw error;
        });
        if (invalidation.signal.aborted) throw invalidation.signal.reason;
        signal?.throwIfAborted();
        if (result.cancelled) throw new DOMException('Research stage cancelled', 'AbortError');
        if (!result.success || !result.runId)
          throw new Error(result.error ?? `Research stage ${stage.stage} failed`);
        if (!result.judgeToolOutput)
          throw new Error(
            `Research stage ${stage.stage} completed without submit_research_document`
          );
        return SubmitResearchDocumentResultSchema.parse(JSON.parse(result.judgeToolOutput)).data;
      },
    },
  });
  return async input => {
    // Host-only 是接纳事实，而不只是隐藏 schema；普通模型伪造工具名不能启动研究。
    const descriptor = await new SqliteRunDescriptorStore(db).load(runId);
    const entry = descriptor?.options?.host_tool_call;
    if (
      !descriptor ||
      descriptor.child ||
      descriptor.conversationId !== conversationId ||
      entry?.tool_name !== 'research_run' ||
      entry.completion_mode !== 'yield_after_batch' ||
      !isDeepStrictEqual(ResearchRunArgsSchema.parse(entry.args), input)
    ) {
      throw new ResearchHostEntryError();
    }
    return useCase.execute(input, identity, context.abortSignal);
  };
}

class ResearchHostEntryError extends Error {
  readonly code = 'RESEARCH_HOST_ENTRY_REQUIRED';
  constructor() {
    super(
      'research_run requires a matching durable Host admission; select the research entry to start a research task.'
    );
  }
}
