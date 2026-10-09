import type { ResearchStage } from '@app/schemas';
import type { ResearchStageReceipt } from '../definitions/researchStageReceipt';
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
  if (stage === 'investigation_review' && selected.some(item => item.stage.endsWith('_review')))
    throw new Error('An independent investigation review must not receive other reviews.');
  if (stage === 'draft') {
    const review = one(selected, 'investigation_review');
    if (!selected.some(item => item.stage === 'investigation' && consumes(review, item)))
      throw new Error('The investigation review must cover a supplied investigation version.');
  }
  if (stage === 'argument_review' || stage === 'source_review') {
    one(selected, 'draft');
    if (
      selected.some(
        item =>
          item.stage === 'argument_review' ||
          item.stage === 'source_review' ||
          item.stage === 'revision'
      )
    )
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
