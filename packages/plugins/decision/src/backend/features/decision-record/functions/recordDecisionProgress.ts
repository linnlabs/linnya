import type { DecisionRecord, DecisionActionProgress, DecisionActionReviewRequest, DecisionReportProvenance } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { applyDecisionFeedback } from './applyDecisionFeedback';
import { currentDecisionActionPlan } from './projectDecisionActions';
import { validateDecisionActionPlan } from './validateDecisionActionPlan';
import { validateReportedPlanRevision } from './validateReportedPlanRevision';

export function recordDecisionProgress(record: DecisionRecord, actionId: string, reportId: string, progress: DecisionActionProgress, provenance: DecisionReportProvenance): DecisionRecord {
  const action = record.actions?.find(item => item.id === actionId);
  if (!action) throw new DecisionFailure('not_found', 'Action not found in this decision.');
  if (action.result) throw new DecisionFailure('invalid_model', 'Action is closed. A withdrawn final report does not reopen it; plan a new action explicitly.');
  validateReportedPlanRevision(action, progress.planRevision);
  const next = applyDecisionFeedback(record, progress.update);
  return {
    ...next, reason: `Action progress reported: ${progress.summary}`,
    actions: (record.actions ?? []).map(item => item.id !== actionId ? item : {
      ...item, progressReports: [...(item.progressReports ?? []), {
        id: reportId, summary: progress.summary, origin: progress.origin, actualCost: progress.actualCost,
        provenance, basedOnPlanRevision: progress.planRevision,
        receivedAgainstPlanRevision: currentDecisionActionPlan(item).planRevision,
        receivedAtRevision: next.revision, receivedAgainstInputRevision: record.inputRevision, resultingInputRevision: next.inputRevision,
      }],
    }),
  };
}

export function reviewDecisionAction(record: DecisionRecord, actionId: string, review: DecisionActionReviewRequest, provenance: DecisionReportProvenance): DecisionRecord {
  const action = record.actions?.find(item => item.id === actionId);
  if (!action) throw new DecisionFailure('not_found', 'Action not found in this decision.');
  if (action.result) throw new DecisionFailure('invalid_model', 'Action is closed; its final report and plan history cannot be reopened by review.');
  validateDecisionActionPlan(record, review.plan);
  return {
    ...record, revision: record.revision + 1, reason: `Action plan reviewed: ${review.reason}`,
    actions: (record.actions ?? []).map(item => item.id !== actionId ? item : {
      ...item, reviews: [...(item.reviews ?? []), {
        plan: review.plan, reason: review.reason, origin: review.origin, provenance,
        receivedAtRevision: record.revision + 1, basedOnInputRevision: record.inputRevision,
      }],
    }),
  };
}
