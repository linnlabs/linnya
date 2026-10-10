import { runIdFromSubrunId } from '@linnlabs/linnkit/contracts';
import type { ToolContext } from 'src/tools/types';
import type {
  PreparedResearchChildStage,
  ResearchExecutionIdentity,
  ResearchStageReceipt,
} from '../../application/research';
import { researchReviewExcludedInodes } from '../../application/research';
import {
  ResearchInputsChangedError,
  type ResearchStageSubmission,
} from '../../application/research/definitions/researchUseCase';
import { derivePluginAwareToolContext } from '../../plugin-registry/toolContextDerivation';
import {
  ResearchSubmissionScopeError,
  serializeResearchDocumentSubmission,
} from './SubmitResearchDocumentTool';

/** 单阶段写入能力绑定真实 child，统一委派与旧运行恢复共用同一个出口。 */
export function bindResearchStageSubmission(
  context: ToolContext,
  stage: PreparedResearchChildStage,
  owner: ResearchExecutionIdentity,
  submit: ResearchStageSubmission,
  currentReceipts: () => readonly ResearchStageReceipt[],
  signal?: AbortSignal
) {
  const invalidation = new AbortController();
  const stageSignal = signal ? AbortSignal.any([signal, invalidation.signal]) : invalidation.signal;
  const expectedRunId = runIdFromSubrunId(stage.subrunId);
  const inheritedScope = context.resolveWorkspaceNodeAccessScope;
  return {
    context: derivePluginAwareToolContext(context, {
      researchCompletion: undefined,
      researchRetrievalAllowed: stage.invocation.task_type !== 'fixed',
      abortSignal: stageSignal,
      resolveWorkspaceNodeAccessScope() {
        // 旧并行评审可能在本 child 启动后才提交；不能冻结启动时的空拒绝集。
        const excluded = researchReviewExcludedInodes(stage, currentReceipts());
        return {
          excludedNodeIds: [
            ...new Set([
              ...(inheritedScope?.().excludedNodeIds ?? []),
              ...excluded.map(inode => inode.slice('workspace:'.length)),
            ]),
          ],
        };
      },
      async researchDocumentSubmission(input, caller) {
        const callId = caller.parentToolCallId;
        const receipts = caller.toolResultReceipts;
        if (
          'stage' in input ||
          caller.runId !== expectedRunId ||
          caller.conversationId !== owner.conversationId ||
          !callId ||
          !receipts
        )
          throw new ResearchSubmissionScopeError();
        try {
          return await submit({
            sourceRunId: expectedRunId,
            content: input.content,
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
          if (error instanceof ResearchInputsChangedError) invalidation.abort(error);
          throw error;
        }
      },
    }),
    assertActive() {
      stageSignal.throwIfAborted();
    },
  };
}
