import type { ResearchStage } from '@app/schemas';
import type {
  PreparedResearchChildStage,
  ResearchStageReceipt,
} from '../definitions/researchStageReceipt';
import { sameDocumentVersion } from './researchStagePlan';

export const RESEARCH_SUBAGENT_STAGES = {
  research_investigation: 'investigation',
  research_investigation_review: 'investigation_review',
  research_draft: 'draft',
  research_argument_review: 'argument_review',
  research_source_review: 'source_review',
  research_revision: 'revision',
} satisfies Record<string, ResearchStage>;

export function researchDelegationStage(type: string): ResearchStage {
  const entry = Object.entries(RESEARCH_SUBAGENT_STAGES).find(([key]) => key === type);
  if (!entry) throw new Error(`Unknown research delegation type: ${type}`);
  return entry[1];
}

function one(
  receipts: readonly ResearchStageReceipt[],
  stage: ResearchStage
): ResearchStageReceipt {
  const matches = receipts.filter(item => item.stage === stage && item.artifact);
  const selected = matches[0];
  if (matches.length !== 1 || !selected)
    throw new Error(`Supply exactly one completed ${stage} document in input_documents.`);
  return selected;
}

function consumes(consumer: ResearchStageReceipt, source: ResearchStageReceipt): boolean {
  return Boolean(
    source.artifact &&
      consumer.inputs.some(input => source.artifact && sameDocumentVersion(input, source.artifact))
  );
}

/** 显式交接和后续文件访问共用资格规则，避免“没传给它”却仍能搜索到。 */
function isExcludedReviewInput(stage: ResearchStage, inputStage: ResearchStage): boolean {
  if (stage === 'investigation_review') return inputStage.endsWith('_review');
  if (stage === 'argument_review' || stage === 'source_review')
    return (
      inputStage === 'argument_review' ||
      inputStage === 'source_review' ||
      inputStage === 'revision'
    );
  return false;
}

export function researchReviewExcludedInodes(
  reviewer: PreparedResearchChildStage,
  receipts: readonly ResearchStageReceipt[]
): readonly string[] {
  return receipts.flatMap(receipt => {
    // 原子提交后的自身稿件可回读；其他同角色复核仍不是独立输入。
    if ('subrunId' in receipt && receipt.subrunId === reviewer.subrunId) return [];
    return receipt.artifact && isExcludedReviewInput(reviewer.stage, receipt.stage)
      ? [receipt.artifact.inode]
      : [];
  });
}

/** 校验交接前提，不选下一阶段，不替模型评价内容。补查可以产生多次独立调查。 */
export function validateResearchDelegationInputs(
  stage: ResearchStage,
  selected: readonly ResearchStageReceipt[]
): void {
  const requiresInvestigation = stage !== 'investigation';
  if (
    requiresInvestigation &&
    !selected.some(item => item.stage === 'investigation' && item.artifact)
  )
    throw new Error('Include the investigation document in input_documents.');
  if (
    stage === 'investigation_review' &&
    selected.some(item => isExcludedReviewInput(stage, item.stage))
  )
    throw new Error('An independent investigation review must not receive other reviews.');
  if (stage === 'draft') {
    const review = one(selected, 'investigation_review');
    if (!selected.some(item => item.stage === 'investigation' && consumes(review, item)))
      throw new Error('The investigation review must cover a supplied investigation version.');
  }
  if (stage === 'argument_review' || stage === 'source_review') {
    one(selected, 'draft');
    if (selected.some(item => isExcludedReviewInput(stage, item.stage)))
      throw new Error(
        'Independent article reviewers must not receive each other’s findings or a revision.'
      );
  }
  if (stage === 'revision') {
    const draft = one(selected, 'draft');
    for (const kind of ['argument_review', 'source_review'] as const) {
      if (!consumes(one(selected, kind), draft))
        throw new Error('Both independent reviews must cover the exact supplied draft version.');
    }
    const argumentInputs = one(selected, 'argument_review').inputs;
    const sourceInputs = one(selected, 'source_review').inputs;
    if (
      argumentInputs.length !== sourceInputs.length ||
      argumentInputs.some(input => !sourceInputs.some(other => sameDocumentVersion(input, other)))
    )
      throw new Error('Both independent reviews must receive identical draft and source context.');
  }
}

export function researchRevisionReviews(
  revision: ResearchStageReceipt,
  all: readonly ResearchStageReceipt[]
): readonly ResearchStageReceipt[] {
  const selected = all.filter(item => consumes(revision, item));
  validateResearchDelegationInputs('revision', selected);
  return [one(selected, 'argument_review'), one(selected, 'source_review')];
}

/** 写作属于父 Agent；专项调查材料不能取代它自己保存的主调查记录。 */
export function validateResearchParentInputs(
  stage: 'investigation' | 'draft' | 'revision',
  selected: readonly ResearchStageReceipt[]
): void {
  if (stage === 'investigation') return;
  if (!selected.some(item => item.stage === 'investigation' && 'runId' in item && item.artifact))
    throw new Error('Include the lead Agent’s saved investigation record in input_documents.');
  if (
    stage === 'draft' &&
    selected.some(
      item =>
        item.stage === 'draft' ||
        item.stage === 'argument_review' ||
        item.stage === 'source_review' ||
        item.stage === 'revision'
    )
  )
    throw new Error('An initial draft cannot depend on article reviews or an existing article.');
  if (stage === 'revision') {
    validateResearchDelegationInputs(stage, selected);
    if (!('runId' in one(selected, 'draft')))
      throw new Error('Revise the lead Agent’s own submitted draft.');
  }
}
