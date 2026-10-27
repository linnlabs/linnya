import type { DecisionExpression, DecisionModel } from '../../../../shared';
import type { ExpressionResult } from '../definitions/decisionEvaluation';

export function collectExpressionInputs(expression: DecisionExpression): readonly string[] {
  if ('input' in expression) return [expression.input];
  if ('literal' in expression) return [];
  return [...new Set([
    ...collectExpressionInputs(expression.left),
    ...collectExpressionInputs(expression.right),
  ])];
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
