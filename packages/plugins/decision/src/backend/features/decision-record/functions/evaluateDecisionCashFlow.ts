import type { DecisionModel } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { collectExpressionInputs } from './evaluateDecisionExpression';
import { evaluateCashFlow } from './evaluateCashFlow';
import { projectCashFlowTiming } from './projectCashFlowTiming';

export function validateDecisionCashFlows(model: DecisionModel): void {
  const ids = model.cashFlows?.map(flow => flow.id) ?? [];
  if (new Set(ids).size !== ids.length) throw new DecisionFailure('invalid_model', 'Duplicate cash flow id.');
  for (const flow of model.cashFlows ?? []) {
    if (!model.options.some(option => option.id === flow.optionId)) throw new DecisionFailure('invalid_model', `Unknown cash flow option: ${flow.optionId}`);
    if (new Set(flow.entries.map(entry => entry.id)).size !== flow.entries.length) throw new DecisionFailure('invalid_model', `Duplicate payment entry in ${flow.id}`);
    for (const expression of [flow.openingBalance, ...flow.entries.flatMap(entry => entry.at === null ? [entry.amount] : [entry.amount, entry.at])]) {
      for (const id of collectExpressionInputs(expression)) {
        const input = model.inputs.find(input => input.id === id);
        if (!input) throw new DecisionFailure('invalid_model', `Cash flow ${flow.id}: unknown input ${id}.`);
      }
    }
    for (const entry of flow.entries) {
      if (entry.at === null) continue;
      for (const id of collectExpressionInputs(entry.at)) {
        if (model.inputs.find(input => input.id === id)?.quantityType !== 'duration') {
          throw new DecisionFailure('invalid_model', `Cash flow ${flow.id}: time input ${id} must declare quantityType=duration; expression result is days.`);
        }
      }
    }
  }
}

/** 当前余额与日期门槛共用已声明模型，时间假设不写回事实。 */
export function evaluateDecisionCashFlows(model: DecisionModel) {
  return (model.cashFlows ?? []).map(flow => ({ ...evaluateCashFlow(model, flow), timingThresholds: projectCashFlowTiming(model, flow) }));
}
