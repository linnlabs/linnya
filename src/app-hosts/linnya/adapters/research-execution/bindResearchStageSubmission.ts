import { runIdFromSubrunId } from '@linnlabs/linnkit/contracts';
import type { ToolContext } from 'src/tools/types';
import type { PreparedResearchStage, ResearchExecutionIdentity } from '../../application/research';
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
  stage: PreparedResearchStage,
  owner: ResearchExecutionIdentity,
  submit: ResearchStageSubmission,
  signal?: AbortSignal
) {
  const invalidation = new AbortController();
  const stageSignal = signal ? AbortSignal.any([signal, invalidation.signal]) : invalidation.signal;
  const expectedRunId = runIdFromSubrunId(stage.subrunId);
  return {
    context: derivePluginAwareToolContext(context, {
      researchCompletion: undefined,
      researchRetrievalAllowed: stage.invocation.task_type !== 'fixed',
      abortSignal: stageSignal,
      async researchDocumentSubmission(content, caller) {
        const callId = caller.parentToolCallId;
        const receipts = caller.toolResultReceipts;
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
