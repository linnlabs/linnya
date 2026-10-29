import type { DecisionExpression, DecisionModel } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { collectExpressionInputs, evaluateExpression } from './evaluateDecisionExpression';
import { collectCheckInputs, evaluateDecisionCheck } from './evaluateDecisionCheck';
import { validateDecisionCashFlows, evaluateDecisionCashFlows } from './evaluateDecisionCashFlow';

export function validateDecisionModel(model: DecisionModel): void {
  for (const [kind, items] of [
    ['input', model.inputs], ['option', model.options],
    ['calculation', model.calculations], ['check', model.checks],
  ] as const) {
    const ids = items.map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new DecisionFailure('invalid_model', `Duplicate ${kind} id.`);
  }
  const inputs = new Set(model.inputs.map(input => input.id));
  const options = new Set(model.options.map(option => option.id));
  for (const item of model.calculations) validateReferences(item.expression, inputs);
  for (const item of model.checks) {
    if (!options.has(item.optionId)) throw new DecisionFailure('invalid_model', `Unknown option: ${item.optionId}`);
    for (const input of collectCheckInputs(item)) {
      if (!inputs.has(input)) throw new DecisionFailure('invalid_model', `Unknown input: ${input}`);
    }
  }
  validateDecisionCashFlows(model);
}

function validateReferences(expression: DecisionExpression, inputs: ReadonlySet<string>): void {
  for (const input of collectExpressionInputs(expression)) {
    if (!inputs.has(input)) throw new DecisionFailure('invalid_model', `Unknown input: ${input}`);
  }
}

export function evaluateDecisionModel(model: DecisionModel) {
  validateDecisionModel(model);
  return {
    ...(model.cashFlows ? { cashFlows: evaluateDecisionCashFlows(model) } : {}),
    calculations: model.calculations.map(item => ({
      id: item.id,
      label: item.label,
      unit: item.unit,
      quantityType: item.quantityType,
      inputIds: collectExpressionInputs(item.expression),
      result: evaluateExpression(item.expression, model),
    })),
    checks: model.checks.map(item => evaluateDecisionCheck(item, model)),
  };
}
