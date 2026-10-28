import type { DecisionAction } from '../../../../shared';
import { currentDecisionActionPlan } from './projectDecisionActions';
import { DecisionFailure } from '../definitions/decisionFailure';

export function validateReportedPlanRevision(action: DecisionAction, planRevision: number): void {
  if (planRevision > currentDecisionActionPlan(action).planRevision) {
    throw new DecisionFailure('invalid_model', `Unknown planRevision ${planRevision} for this action. Read its original plan and reviews.`);
  }
}
