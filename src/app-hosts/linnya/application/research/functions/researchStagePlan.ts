import { createHash } from 'node:crypto';
import type { ResearchRunArgs, ResearchRunArtifact, ResearchStage } from '@app/schemas';
import { ResearchRunArtifactSchema } from '@app/schemas';
import {
  ResearchDocumentError,
  type ResearchDocumentBinding,
  type ResearchDocumentSnapshot,
} from '../definitions/researchDocumentPort';
import type {
  PreparedResearchStage,
  ResearchExecutionIdentity,
  ResearchStageReceipt,
} from '../definitions/researchStageReceipt';
import { buildResearchStageRequest } from './buildResearchStageRequest';

export const RESEARCH_STAGE_ORDER: readonly ResearchStage[] = [
  'investigation',
  'investigation_review',
  'draft',
  'argument_review',
  'source_review',
  'revision',
];
export const RESEARCH_STAGE_PURPOSE: Record<ResearchStage, string> = {
  investigation: '调查记录',
  investigation_review: '独立调查复核',
  draft: '初稿',
  argument_review: '论证复核',
  source_review: '来源与数字复核',
  revision: '修订稿',
};
export function documentBinding(value: ResearchDocumentSnapshot): ResearchDocumentBinding {
  return {
    inode: value.inode,
    locator: value.locator,
    representation: value.representation,
    sha256: value.sha256,
    citationSha256: value.citationSha256,
  };
}
export function sameDocumentVersion(
  a: ResearchDocumentBinding,
  b: ResearchDocumentBinding
): boolean {
  return (
    a.inode === b.inode &&
    a.locator === b.locator &&
    a.representation === b.representation &&
    a.sha256 === b.sha256 &&
    a.citationSha256 === b.citationSha256
  );
}
export function assertResearchInvocation(
  input: ResearchRunArgs,
  receipts: readonly ResearchStageReceipt[]
): void {
  if (receipts.some(item => JSON.stringify(item.invocation) !== JSON.stringify(input))) {
    throw new Error(
      'Research invocation changed; admit a new run instead of reusing a stage identity'
    );
  }
}
export function prepareResearchStage(input: {
  stage: ResearchStage;
  invocation: ResearchRunArgs;
  identity: ResearchExecutionIdentity;
  materials: readonly ResearchDocumentBinding[];
  predecessors: readonly ResearchStageReceipt[];
}): PreparedResearchStage {
  const { stage, invocation, identity, materials, predecessors } = input;
  const key = createHash('sha256')
    .update(`${identity.parentRunId}:${identity.toolCallId}`)
    .digest('hex')
    .slice(0, 16);
  const outputPath = `workspace:/research-${key}-${stage}.md`;
  const artifacts = predecessors.map(item => {
    if (!item.artifact)
      throw new Error(`Research predecessor ${item.stage} has no committed artifact`);
    return { receipt: item, binding: item.artifact };
  });
  const scope =
    invocation.task_type === 'fixed'
      ? { taskType: 'fixed' as const, allowRetrieval: false as const }
      : { taskType: invocation.task_type, allowRetrieval: true as const };
  return {
    stage,
    invocation,
    subrunId: `${identity.toolCallId}_${stage}`,
    outputPath,
    inputs: [...materials, ...artifacts.map(item => item.binding)],
    request: buildResearchStageRequest({
      ...scope,
      stage,
      question: invocation.question,
      reader: invocation.reader,
      materialBoundary:
        invocation.task_type === 'fixed'
          ? 'Only the full content of the supplied Workspace documents; missing sources remain unverified.'
          : 'Investigate the stated question using supplied documents and relevant public or authorized sources; preserve acquisition limits.',
      timeRange: invocation.time_range,
      fixedDocumentLocators: materials.map(item => item.locator),
      previousArtifacts: artifacts.map(({ receipt, binding }) => ({
        locator: binding.locator,
        version: `${binding.sha256}/${binding.citationSha256}`,
        purpose: RESEARCH_STAGE_PURPOSE[receipt.stage],
      })),
      unresolvedQuestions: [],
      feedback: [],
      businessAnalysisNeeded: false,
      output: { locator: outputPath, purpose: RESEARCH_STAGE_PURPOSE[stage] },
    }),
  };
}
export function researchArtifacts(
  receipts: readonly ResearchStageReceipt[]
): ResearchRunArtifact[] {
  return RESEARCH_STAGE_ORDER.flatMap(stage => {
    const receipt = receipts.find(item => item.stage === stage);
    const binding = receipt?.artifact;
    return receipt && binding
      ? [
          ResearchRunArtifactSchema.parse({
            stage,
            subrun_id: receipt.subrunId,
            path: binding.locator,
            inode: binding.inode,
            sha256: binding.sha256,
            citation_sha256: binding.citationSha256,
          }),
        ]
      : [];
  });
}

/** 初次读取仍严格报错；只有已经绑定过的输入不再可用时，才属于版本失效。 */
export function isResearchInputInvalidation(error: unknown): boolean {
  return (
    error instanceof ResearchDocumentError &&
    [
      'RESEARCH_DOCUMENT_MISSING',
      'RESEARCH_DOCUMENT_TRUNCATED',
      'RESEARCH_DOCUMENT_INVALID',
      'RESEARCH_DOCUMENT_CITATION_INVALID',
    ].includes(error.code)
  );
}
