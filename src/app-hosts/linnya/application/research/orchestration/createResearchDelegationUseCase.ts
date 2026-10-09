import { isDeepStrictEqual } from 'node:util';
import {
  CompleteResearchResultSchema,
  type CompleteResearchData,
  type ResearchRunArgs,
  type ResearchStage,
} from '@app/schemas';
import type {
  ResearchExecutionIdentity,
  ResearchStageReceipt,
  ResearchStageReceiptPort,
} from '../definitions/researchStageReceipt';
import type { ResearchDocumentPort } from '../definitions/researchDocumentPort';
import {
  documentBinding,
  prepareResearchStage,
  researchArtifacts,
} from '../functions/researchStagePlan';
import {
  researchRevisionReviews,
  validateResearchDelegationInputs,
} from '../functions/researchDelegationPlan';
import {
  checkResearchDocumentVersions,
  createResearchStageSession,
} from './createResearchStageSession';

interface DelegationPorts {
  documents: ResearchDocumentPort;
  receipts: ResearchStageReceiptPort & {
    listRun(identity: Omit<ResearchExecutionIdentity, 'toolCallId'>): readonly {
      identity: ResearchExecutionIdentity;
      receipt: ResearchStageReceipt;
    }[];
  };
  childCompleted(subrunId: string, parentRunId: string): Promise<boolean>;
}

/** 一次委派一次接纳。顺序来自主 Agent 的工具调用，不再隐藏启动后继。 */
export function createResearchDelegationUseCase(ports: DelegationPorts) {
  async function checkLineage(
    identity: ResearchExecutionIdentity,
    targets: readonly ResearchStageReceipt[],
    all: readonly ResearchStageReceipt[],
    signal?: AbortSignal
  ) {
    const visited = new Set<string>();
    async function visit(receipt: ResearchStageReceipt): Promise<void> {
      if (visited.has(receipt.subrunId)) return;
      visited.add(receipt.subrunId);
      if (
        !receipt.artifact ||
        !(await ports.childCompleted(receipt.subrunId, identity.parentRunId))
      )
        throw new Error(`Research input ${receipt.stage} has not completed its child run.`);
      await checkResearchDocumentVersions(
        ports.documents,
        identity.projectId,
        [...receipt.inputs, receipt.artifact],
        signal
      );
      for (const dependency of all.filter(
        item =>
          item.artifact &&
          receipt.inputs.some(input => item.artifact && input.inode === item.artifact.inode)
      ))
        await visit(dependency);
    }
    for (const target of targets) await visit(target);
  }
  return {
    async prepare(input: {
      identity: ResearchExecutionIdentity;
      invocation: ResearchRunArgs;
      stage: ResearchStage;
      instructions: string;
      documents: readonly string[];
      signal?: AbortSignal;
    }) {
      const { identity, invocation, stage, signal } = input;
      signal?.throwIfAborted();
      const all = ports.receipts.listRun(identity).map(item => item.receipt);
      if (all.some(item => !isDeepStrictEqual(item.invocation, invocation)))
        throw new Error('Research scope differs from the admitted parent request.');
      const existing = ports.receipts.list(identity)[0];
      if (existing) {
        if (existing.stage !== stage)
          throw new Error('Cannot change the role of an admitted delegation.');
        // 同一次工具恢复只消费原请求；不用新读到的文档悄悄刷新版本。
        if (
          !isDeepStrictEqual(existing.delegation, {
            instructions: input.instructions,
            documents: input.documents,
          })
        )
          throw new Error('Cannot change the assignment of an admitted delegation.');
        await checkLineage(
          identity,
          all.filter(
            item =>
              item.artifact &&
              existing.inputs.some(
                binding => item.artifact && binding.inode === item.artifact.inode
              )
          ),
          all,
          signal
        );
        return {
          prepared: existing,
          session: await createResearchStageSession(ports, identity, existing, signal),
        };
      }
      if (stage === 'revision' && all.some(item => item.stage === 'revision'))
        throw new Error(
          'This research run admits one revision; resume its original delegation instead of starting another.'
        );
      const locators = [...new Set([...invocation.materials, ...input.documents])];
      const snapshots = await Promise.all(
        locators.map(locator => ports.documents.read({ projectId: identity.projectId, locator }))
      );
      signal?.throwIfAborted();
      const selected = all.filter(
        item =>
          item.artifact &&
          snapshots.some(value => item.artifact && value.inode === item.artifact.inode)
      );
      if (
        invocation.task_type === 'fixed' &&
        snapshots.some(
          snapshot =>
            !invocation.materials.includes(snapshot.locator) &&
            !selected.some(item => item.artifact?.inode === snapshot.inode)
        )
      )
        throw new Error(
          'Fixed research only accepts admitted source documents and this run’s submitted artifacts.'
        );
      validateResearchDelegationInputs(stage, selected);
      await checkLineage(identity, selected, all, signal);
      const materials = snapshots
        .filter(snapshot => !selected.some(item => item.artifact?.inode === snapshot.inode))
        .map(documentBinding);
      const planned = prepareResearchStage({
        stage,
        invocation,
        identity,
        materials,
        predecessors: selected,
      });
      const prepared = ports.receipts.prepare(identity, {
        ...planned,
        delegation: { instructions: input.instructions, documents: input.documents },
        request: {
          ...planned.request,
          query: `${planned.request.query}\n\n## Lead Agent assignment\n${input.instructions}`,
        },
      });
      return {
        prepared,
        session: await createResearchStageSession(ports, identity, prepared, signal),
      };
    },
    async complete(
      identity: ResearchExecutionIdentity,
      locator: string,
      signal?: AbortSignal
    ): Promise<CompleteResearchData> {
      const all = ports.receipts.listRun(identity).map(item => item.receipt);
      const revision = all.find(
        item => item.stage === 'revision' && item.artifact?.locator === locator
      );
      if (!revision)
        throw new Error(
          'Select a revision submitted by this research run; a path or TaskState completion is not a delivery receipt.'
        );
      const reviews = researchRevisionReviews(revision, all);
      await checkLineage(identity, [revision], all, signal);
      const artifact = researchArtifacts([revision])[0];
      return CompleteResearchResultSchema.parse({
        data: { artifact, review_artifacts: reviews.flatMap(item => researchArtifacts([item])) },
        observation: 'Document handoff checked; content quality is not certified.',
      }).data;
    },
  };
}
