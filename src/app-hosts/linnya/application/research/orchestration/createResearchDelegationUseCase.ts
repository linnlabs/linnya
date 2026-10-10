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
  PreparedResearchParentStage,
} from '../definitions/researchStageReceipt';
import type { ResearchDocumentPort } from '../definitions/researchDocumentPort';
import {
  documentBinding,
  prepareResearchStage,
  researchArtifacts,
  researchStageOutputPath,
} from '../functions/researchStagePlan';
import {
  researchRevisionReviews,
  validateResearchDelegationInputs,
  validateResearchParentInputs,
} from '../functions/researchDelegationPlan';
import {
  checkResearchDocumentVersions,
  createResearchStageSession,
} from './createResearchStageSession';

interface DelegationPorts {
  authoring: 'parent' | 'delegated';
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
      if (!receipt.artifact)
        throw new Error(`Research input ${receipt.stage} has no submitted document.`);
      // 同一父 run 可以提交多份稿件，不能按作者身份去重而漏查初稿或修订稿。
      if (visited.has(receipt.artifact.inode)) return;
      visited.add(receipt.artifact.inode);
      if ('runId' in receipt) {
        if (receipt.runId !== identity.parentRunId)
          throw new Error('Research document belongs to another parent run.');
      } else if (!(await ports.childCompleted(receipt.subrunId, identity.parentRunId))) {
        throw new Error(`Research input ${receipt.stage} has not completed its child run.`);
      }
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
  async function currentReceipts(
    identity: ResearchExecutionIdentity,
    invocation: ResearchRunArgs,
    signal?: AbortSignal
  ) {
    const all = ports.receipts.listRun(identity).map(item => item.receipt);
    if (all.some(item => !isDeepStrictEqual(item.invocation, invocation)))
      throw new Error('Research scope differs from the admitted parent request.');
    // 显式接纳材料在首次委派绑定后不可在同一根运行悄悄刷新版本。
    // 回执已经持有这些事实，不增加第二个根级材料账本。
    const admittedLocators = new Set<string>(invocation.materials);
    const admittedBindings = all
      .flatMap(item => item.inputs)
      .filter(binding => admittedLocators.has(binding.locator));
    await checkResearchDocumentVersions(
      ports.documents,
      identity.projectId,
      [...new Map(admittedBindings.map(binding => [binding.inode, binding])).values()],
      signal
    );
    return all;
  }

  async function inputsFor(
    identity: ResearchExecutionIdentity,
    invocation: ResearchRunArgs,
    documents: readonly string[],
    all: readonly ResearchStageReceipt[],
    signal?: AbortSignal
  ) {
    const locators = [...new Set([...invocation.materials, ...documents])];
    const snapshots = await Promise.all(
      locators.map(locator => ports.documents.read({ projectId: identity.projectId, locator }))
    );
    signal?.throwIfAborted();
    const selected = all.filter(
      item => item.artifact && snapshots.some(value => value.inode === item.artifact?.inode)
    );
    if (
      invocation.task_type === 'fixed' &&
      snapshots.some(
        snapshot =>
          !invocation.materials.some(locator => locator === snapshot.locator) &&
          !selected.some(item => item.artifact?.inode === snapshot.inode)
      )
    )
      throw new Error(
        'Fixed research only accepts admitted source documents and this run’s submitted artifacts.'
      );
    await checkLineage(identity, selected, all, signal);
    return {
      selected,
      materials: snapshots
        .filter(snapshot => !selected.some(item => item.artifact?.inode === snapshot.inode))
        .map(documentBinding),
    };
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
      if (ports.authoring === 'parent' && (stage === 'draft' || stage === 'revision'))
        throw new Error(
          'The lead Agent writes its own draft and revision with submit_research_document.'
        );
      const all = await currentReceipts(identity, invocation, signal);
      const existing = ports.receipts.list(identity)[0];
      if (existing) {
        if ('runId' in existing)
          throw new Error('A parent submission cannot become a child delegation.');
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
      const { selected, materials } = await inputsFor(
        identity,
        invocation,
        input.documents,
        all,
        signal
      );
      validateResearchDelegationInputs(stage, selected);
      const planned = prepareResearchStage({
        stage,
        invocation,
        identity,
        materials,
        predecessors: selected,
        ...(ports.authoring === 'parent' ? { boundedAssignment: input.instructions } : {}),
      });
      const prepared = ports.receipts.prepare(identity, {
        ...planned,
        // Provider 工具 ID 只在一次运行内唯一；不能让另一个根运行复用同名 child。
        subrunId: `${identity.parentRunId}:${planned.subrunId}`,
        delegation: { instructions: input.instructions, documents: input.documents },
        request: {
          ...planned.request,
          query:
            ports.authoring === 'parent'
              ? planned.request.query
              : `${planned.request.query}\n\n## Lead Agent assignment\n${input.instructions}`,
        },
      });
      if ('runId' in prepared) throw new Error('Expected the admitted child delegation.');
      return {
        prepared,
        session: await createResearchStageSession(ports, identity, prepared, signal),
      };
    },
    async prepareParent(input: {
      identity: ResearchExecutionIdentity;
      invocation: ResearchRunArgs;
      stage: PreparedResearchParentStage['stage'];
      documents: readonly string[];
      signal?: AbortSignal;
    }) {
      if (ports.authoring !== 'parent')
        throw new Error(
          'This admitted research run delegates authorship; resume its original contract.'
        );
      const { identity, invocation, stage, signal } = input;
      signal?.throwIfAborted();
      const all = await currentReceipts(identity, invocation, signal);
      const existing = ports.receipts.list(identity)[0];
      if (existing) {
        if (
          !('runId' in existing) ||
          existing.stage !== stage ||
          !isDeepStrictEqual(existing.submission.documents, input.documents)
        )
          throw new Error('Cannot change an admitted parent submission.');
        await checkLineage(
          identity,
          all.filter(
            item =>
              item.artifact &&
              existing.inputs.some(binding => binding.inode === item.artifact?.inode)
          ),
          all,
          signal
        );
        return {
          prepared: existing,
          session: await createResearchStageSession(ports, identity, existing, signal),
        };
      }
      if (all.some(item => 'runId' in item && item.stage === stage && item.artifact))
        throw new Error(`The lead Agent has already submitted ${stage}; preserve that version.`);
      const { selected, materials } = await inputsFor(
        identity,
        invocation,
        input.documents,
        all,
        signal
      );
      validateResearchParentInputs(stage, selected);
      const prepared = ports.receipts.prepare(identity, {
        stage,
        invocation,
        runId: identity.parentRunId,
        submission: { documents: input.documents },
        inputs: [...materials, ...selected.flatMap(item => (item.artifact ? [item.artifact] : []))],
        outputPath: researchStageOutputPath(identity, stage),
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
