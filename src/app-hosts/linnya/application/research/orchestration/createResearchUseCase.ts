import { ResearchRunArgsSchema, ResearchRunDataSchema, type ResearchRunData, type ResearchStage } from '@app/schemas';
import { ResearchDocumentError, type ResearchDocumentBinding } from '../definitions/researchDocumentPort';
import type { ResearchUseCase, ResearchUseCasePorts } from '../definitions/researchUseCase';
import type { ResearchStageReceipt } from '../definitions/researchStageReceipt';
import { assertResearchInvocation, documentBinding, prepareResearchStage, researchArtifacts, sameDocumentVersion } from '../functions/researchStagePlan';

class ChangedResearchInputs extends Error {
  constructor(readonly paths: readonly string[]) { super('Research inputs changed'); }
}

/** 固定研究流程；run/child 的暂停、取消、恢复仍由既有运行 owner 承担。 */
export function createResearchUseCase(ports: ResearchUseCasePorts): ResearchUseCase {
  return {
    async execute(rawInput, identity, signal) {
      const input = ResearchRunArgsSchema.parse(rawInput);
      const recorded = ports.receipts.list(identity);
      assertResearchInvocation(input, recorded);
      const first = recorded.find(item => item.stage === 'investigation');
      // 恢复从已冻结的身份开始，不能悄悄把当前文件接纳为原来的输入。
      const materials = first?.inputs ?? await Promise.all(input.materials.map(async locator =>
        documentBinding(await ports.documents.read({ projectId: identity.projectId, locator }))));

      async function checkCurrent(bindings: readonly ResearchDocumentBinding[]): Promise<void> {
        signal?.throwIfAborted();
        const changes: string[] = [];
        for (const binding of bindings) {
          try {
            const current = await ports.documents.read({ projectId: identity.projectId, inode: binding.inode });
            if (!sameDocumentVersion(binding, current)) changes.push(binding.locator);
          } catch (error) {
            if (error instanceof ResearchDocumentError && error.code === 'RESEARCH_DOCUMENT_MISSING') changes.push(binding.locator);
            else throw error;
          }
        }
        if (changes.length) throw new ChangedResearchInputs([...new Set(changes)]);
      }

      async function stage(name: ResearchStage, predecessors: readonly ResearchStageReceipt[]): Promise<ResearchStageReceipt> {
        signal?.throwIfAborted();
        const existing = ports.receipts.list(identity).find(item => item.stage === name);
        const prepared = existing ?? ports.receipts.prepare(identity,
          prepareResearchStage({ stage: name, invocation: input, identity, materials, predecessors }));
        await checkCurrent(prepared.inputs);
        if (prepared.artifact) {
          await checkCurrent([prepared.artifact]);
          return prepared;
        }
        const result = await ports.children.execute(prepared, identity, signal);
        signal?.throwIfAborted();
        if (!result.text.trim()) throw new Error(`Research stage ${name} produced no document`);
        // 保存独立候选稿；如果调查期间输入变化，旧输入绑定和候选仍可追溯，但不能接纳后继。
        await ports.documents.save({
          projectId: identity.projectId, conversationId: identity.conversationId,
          sourceRunId: result.sourceRunId, path: prepared.outputPath, text: result.text,
          receipt: {
            prepare: () => ports.receipts.assertPrepared(identity, prepared),
            commit: binding => ports.receipts.commitArtifact(identity, prepared, binding),
          },
        });
        const committed = ports.receipts.list(identity).find(item => item.stage === name);
        if (!committed?.artifact) throw new Error(`Research stage ${name} has no committed document receipt`);
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
          stage('argument_review', beforeReview), stage('source_review', beforeReview),
        ]);
        const rejected = reviews.find(item => item.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
        const accepted = reviews.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
        await stage('revision', [...beforeReview, ...accepted]);
        const result: ResearchRunData = { status: 'delivered', model_id: identity.modelId,
          artifacts: researchArtifacts(ports.receipts.list(identity)) };
        return ResearchRunDataSchema.parse(result);
      } catch (error) {
        if (!(error instanceof ChangedResearchInputs)) throw error;
        return ResearchRunDataSchema.parse({ status: 'inputs_changed', model_id: identity.modelId,
          artifacts: researchArtifacts(ports.receipts.list(identity)), changed_paths: error.paths });
      }
    },
  };
}
