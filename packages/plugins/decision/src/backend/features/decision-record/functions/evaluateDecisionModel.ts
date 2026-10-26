import type { DecisionExpression, DecisionModel } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';

export type ExpressionResult =
  | { readonly status: 'available'; readonly value: number }
  | { readonly status: 'unavailable'; readonly reason: string };

export function collectExpressionInputs(expression: DecisionExpression): readonly string[] {
  if ('input' in expression) return [expression.input];
  if ('literal' in expression) return [];
  return [...new Set([
    ...collectExpressionInputs(expression.left),
    ...collectExpressionInputs(expression.right),
  ])];
}

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
    validateReferences(item.left, inputs);
    validateReferences(item.right, inputs);
  }
}

function validateReferences(expression: DecisionExpression, inputs: ReadonlySet<string>): void {
  for (const input of collectExpressionInputs(expression)) {
    if (!inputs.has(input)) throw new DecisionFailure('invalid_model', `Unknown input: ${input}`);
  }
}

export function evaluateExpression(
  expression: DecisionExpression,
  model: DecisionModel,
): ExpressionResult {
  if ('literal' in expression) return { status: 'available', value: expression.literal };
  if ('input' in expression) {
    const input = model.inputs.find(item => item.id === expression.input);
    if (!input || input.status === 'withdrawn' || typeof input.value !== 'number') {
      return { status: 'unavailable', reason: `Input ${expression.input} is missing, withdrawn or non-numeric.` };
    }
    return { status: 'available', value: input.value };
  }
  const left = evaluateExpression(expression.left, model);
  const right = evaluateExpression(expression.right, model);
  if (left.status === 'unavailable') return left;
  if (right.status === 'unavailable') return right;
  if (expression.op === 'divide' && right.value === 0) {
    return { status: 'unavailable', reason: 'Division by zero.' };
  }
  const value = expression.op === 'add' ? left.value + right.value
    : expression.op === 'subtract' ? left.value - right.value
    : expression.op === 'multiply' ? left.value * right.value
    : left.value / right.value;
  return Number.isFinite(value)
    ? { status: 'available', value }
    : { status: 'unavailable', reason: 'Non-finite calculation result.' };
}

export function evaluateDecisionModel(model: DecisionModel) {
  validateDecisionModel(model);
  return {
    calculations: model.calculations.map(item => ({
      id: item.id,
      label: item.label,
      unit: item.unit,
      inputIds: collectExpressionInputs(item.expression),
      result: evaluateExpression(item.expression, model),
    })),
    checks: model.checks.map(item => {
      const left = evaluateExpression(item.left, model);
      const right = evaluateExpression(item.right, model);
      const passes = left.status !== 'available' || right.status !== 'available' ? null
        : item.operator === 'lte' ? left.value <= right.value
        : item.operator === 'gte' ? left.value >= right.value
        : left.value === right.value;
      return { id: item.id, optionId: item.optionId, label: item.label, left, right, passes };
    }),
  };
}
