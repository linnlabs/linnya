import type { DecisionRecord, DecisionActionPlan } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';

export function validateDecisionActionPlan(record: DecisionRecord, plan: DecisionActionPlan): void {
  if (new Set(plan.inputIds).size !== plan.inputIds.length) {
    throw new DecisionFailure('invalid_model', 'Action inputIds must not repeat.');
  }
  for (const id of plan.inputIds) {
    const input = record.model.inputs.find(item => item.id === id);
    if (!input) throw new DecisionFailure('invalid_model', `Unknown action input: ${id}`);
    if (input.status === 'withdrawn') throw new DecisionFailure('invalid_model', `Withdrawn action input: ${id}. Review the plan using current evidence.`);
  }
}
