import {
  ResearchRunArgsSchema,
  ResearchRunDataSchema,
  ResearchChildArtifactSchema,
  type ResearchStage,
} from '@app/schemas';
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
} from '../functions/researchStagePlan';

import { createResearchStageSession } from './createResearchStageSession';

/** 旧接纳运行恢复的固定研究流程；run/child 的暂停、取消、恢复仍由既有运行 owner 承担。 */
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
        const session = await createResearchStageSession(ports, identity, prepared, signal);
        if ('runId' in prepared)
          throw new Error('Legacy research requires its admitted child stages.');
        // 已提交文档仍须结算原 child；业务回执不替代运行终态。
        const result = await ports.children.execute(prepared, identity, session.submit, signal);
        return session.accept(result);
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
        const artifacts = researchArtifacts(ports.receipts.list(identity)).map(item =>
          ResearchChildArtifactSchema.parse(item)
        );
        return ResearchRunDataSchema.parse({
          status: 'delivered',
          model_id: identity.modelId,
          subrun_ids: artifacts.map(item => item.subrun_id),
          artifacts,
        });
      } catch (error) {
        if (!(error instanceof ResearchInputsChangedError)) throw error;
        const artifacts = researchArtifacts(ports.receipts.list(identity)).map(item =>
          ResearchChildArtifactSchema.parse(item)
        );
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
