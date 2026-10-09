import { isDeepStrictEqual } from 'node:util';
import type { ResearchRunArtifact } from '@app/schemas';
import type { ResearchDocumentBinding } from '../definitions/researchDocumentPort';
import type {
  ResearchExecutionIdentity,
  ResearchStageReceipt,
} from '../definitions/researchStageReceipt';
import {
  ResearchInputsChangedError,
  type ResearchStageSubmission,
  type ResearchUseCasePorts,
} from '../definitions/researchUseCase';
import {
  documentBinding,
  isResearchInputInvalidation,
  researchArtifacts,
  sameDocumentVersion,
} from '../functions/researchStagePlan';

type StagePorts = Pick<ResearchUseCasePorts, 'documents' | 'receipts'>;

/** 文档版本属于研究交接；运行生命周期继续由统一 child runner 结算。 */
export async function checkResearchDocumentVersions(
  documents: StagePorts['documents'],
  projectId: string,
  bindings: readonly ResearchDocumentBinding[],
  signal?: AbortSignal
): Promise<void> {
  const changes: string[] = [];
  for (const binding of bindings) {
    signal?.throwIfAborted();
    try {
      const current = await documents.read({ projectId, inode: binding.inode });
      if (!sameDocumentVersion(binding, current)) changes.push(binding.locator);
    } catch (error) {
      if (isResearchInputInvalidation(error)) changes.push(binding.locator);
      else throw error;
    }
  }
  signal?.throwIfAborted();
  if (changes.length) throw new ResearchInputsChangedError([...new Set(changes)]);
}

export async function createResearchStageSession(
  ports: StagePorts,
  identity: ResearchExecutionIdentity,
  prepared: ResearchStageReceipt,
  signal?: AbortSignal
): Promise<{
  submit: ResearchStageSubmission;
  accept(result: ResearchRunArtifact): Promise<ResearchStageReceipt>;
}> {
  const check = (bindings: readonly ResearchDocumentBinding[]) =>
    checkResearchDocumentVersions(ports.documents, identity.projectId, bindings, signal);
  await check(prepared.inputs);
  if (prepared.artifact) await check([prepared.artifact]);
  return {
    async submit(submission) {
      signal?.throwIfAborted();
      submission.signal?.throwIfAborted();
      await check(prepared.inputs);
      if (ports.receipts.list(identity).find(item => item.stage === prepared.stage)?.artifact)
        throw new Error('Research stage already submitted; a new tool call cannot overwrite it');
      const saved = await ports.documents.save({
        projectId: identity.projectId,
        conversationId: identity.conversationId,
        sourceRunId: submission.sourceRunId,
        path: prepared.outputPath,
        text: submission.content,
        receipt: {
          prepare() {
            signal?.throwIfAborted();
            submission.signal?.throwIfAborted();
            ports.receipts.assertPrepared(identity, prepared);
            submission.resultCommit.prepare();
          },
          commit(binding) {
            // 编译异步返回后再次消费取消，文档与两个回执必须一起提交或回滚。
            signal?.throwIfAborted();
            submission.signal?.throwIfAborted();
            ports.receipts.commitArtifact(identity, prepared, binding);
            const artifact = researchArtifacts([{ ...prepared, artifact: binding }])[0];
            if (!artifact) throw new Error('Missing submitted artifact');
            submission.resultCommit.commit(artifact);
          },
        },
      });
      const artifact = researchArtifacts([{ ...prepared, artifact: documentBinding(saved) }])[0];
      if (!artifact) throw new Error('Missing submitted artifact');
      return artifact;
    },
    async accept(result) {
      signal?.throwIfAborted();
      const committed = ports.receipts.list(identity).find(item => item.stage === prepared.stage);
      if (!committed?.artifact)
        throw new Error(`Research stage ${prepared.stage} has no committed document receipt`);
      if (!isDeepStrictEqual(result, researchArtifacts([committed])[0]))
        throw new Error('Research child result differs from its committed artifact');
      await check([...prepared.inputs, committed.artifact]);
      return committed;
    },
  };
}
