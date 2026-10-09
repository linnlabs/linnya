import {
  ResearchRunArgsSchema,
  ResearchRunDataSchema,
  type ResearchRunData,
  type ResearchStage,
} from '@app/schemas';
import type { ResearchDocumentBinding } from '../definitions/researchDocumentPort';
import {
  ResearchInputsChangedError,
  type ResearchUseCase,
  type ResearchUseCasePorts,
} from '../definitions/researchUseCase';
import type { ResearchStageReceipt } from '../definitions/researchStageReceipt';
import {
  assertResearchInvocation,
  documentBinding,
  prepareResearchStage,
  researchArtifacts,
  sameDocumentVersion,
  isResearchInputInvalidation,
} from '../functions/researchStagePlan';

/** 固定研究流程；run/child 的暂停、取消、恢复仍由既有运行 owner 承担。 */
export function createResearchUseCase(ports: ResearchUseCasePorts): ResearchUseCase {
  return {
    async execute(rawInput, identity, signal) {
      const input = ResearchRunArgsSchema.parse(rawInput);
      const recorded = ports.receipts.list(identity);
      assertResearchInvocation(input, recorded);
      const first = recorded.find(item => item.stage === 'investigation');
      // 恢复从已冻结的身份开始，不能悄悄把当前文件接纳为原来的输入。
      const materials =
        first?.inputs ??
        (await Promise.all(
          input.materials.map(async locator =>
            documentBinding(await ports.documents.read({ projectId: identity.projectId, locator }))
          )
        ));

      async function checkCurrent(bindings: readonly ResearchDocumentBinding[]): Promise<void> {
        signal?.throwIfAborted();
        const changes: string[] = [];
        for (const binding of bindings) {
          try {
            const current = await ports.documents.read({
              projectId: identity.projectId,
              inode: binding.inode,
            });
            if (!sameDocumentVersion(binding, current)) changes.push(binding.locator);
          } catch (error) {
            if (isResearchInputInvalidation(error)) changes.push(binding.locator);
            else throw error;
          }
        }
        if (changes.length) throw new ResearchInputsChangedError([...new Set(changes)]);
      }

      async function stage(
        name: ResearchStage,
        predecessors: readonly ResearchStageReceipt[]
      ): Promise<ResearchStageReceipt> {
        signal?.throwIfAborted();
        const existing = ports.receipts.list(identity).find(item => item.stage === name);
        const prepared =
          existing ??
          ports.receipts.prepare(
            identity,
            prepareResearchStage({
              stage: name,
              invocation: input,
              identity,
              materials,
              predecessors,
            })
          );
        await checkCurrent(prepared.inputs);
        if (prepared.artifact) await checkCurrent([prepared.artifact]);
        // 即使正文已提交，也必须结算原 child；receipt 不能替代 Runtime 终态。
        const result = await ports.children.execute(
          prepared,
          identity,
          async submission => {
            signal?.throwIfAborted();
            submission.signal?.throwIfAborted();
            await checkCurrent(prepared.inputs);
            if (ports.receipts.list(identity).find(item => item.stage === name)?.artifact)
              throw new Error(
                'Research stage already submitted; a new tool call cannot overwrite it'
              );
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
                  // 编译是异步的；取消不得在编译返回后再落盘、提交 receipt。
                  signal?.throwIfAborted();
                  submission.signal?.throwIfAborted();
                  ports.receipts.commitArtifact(identity, prepared, binding);
                  const artifact = researchArtifacts([{ ...prepared, artifact: binding }])[0];
                  if (!artifact) throw new Error('Missing submitted artifact');
                  submission.resultCommit.commit(artifact);
                },
              },
            });
            const artifact = researchArtifacts([
              { ...prepared, artifact: documentBinding(saved) },
            ])[0];
            if (!artifact) throw new Error('Missing submitted artifact');
            return artifact;
          },
          signal
        );
        signal?.throwIfAborted();
        const committed = ports.receipts.list(identity).find(item => item.stage === name);
        if (!committed?.artifact)
          throw new Error(`Research stage ${name} has no committed document receipt`);
        const accepted = researchArtifacts([committed])[0];
        if (JSON.stringify(result) !== JSON.stringify(accepted))
          throw new Error('Research child result differs from its committed artifact');
        await checkCurrent([...prepared.inputs, committed.artifact]);
        return committed;
      }
      try {
        const investigation = await stage('investigation', []);
        const investigationReview = await stage('investigation_review', [investigation]);
        const draft = await stage('draft', [investigation, investigationReview]);
        const beforeReview = [investigation, investigationReview, draft];
        // 先让同伴正常提交，再传播任何暂停/失败，避免悬挂着另一份仍在写入的评审。
        const reviews = await Promise.allSettled([
          stage('argument_review', beforeReview),
          stage('source_review', beforeReview),
        ]);
        const rejected = reviews.find(item => item.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
        const accepted = reviews.flatMap(item => (item.status === 'fulfilled' ? [item.value] : []));
        await stage('revision', [...beforeReview, ...accepted]);
        const artifacts = researchArtifacts(ports.receipts.list(identity));
        const result: ResearchRunData = {
          status: 'delivered',
          model_id: identity.modelId,
          subrun_ids: artifacts.map(item => item.subrun_id),
          artifacts,
        };
        return ResearchRunDataSchema.parse(result);
      } catch (error) {
        if (!(error instanceof ResearchInputsChangedError)) throw error;
        const artifacts = researchArtifacts(ports.receipts.list(identity));
        return ResearchRunDataSchema.parse({
          status: 'inputs_changed',
          model_id: identity.modelId,
          subrun_ids: artifacts.map(item => item.subrun_id),
          artifacts,
          changed_paths: error.paths,
        });
      }
    },
  };
}
