import type { DecisionExpression, DecisionModel } from '../../../../shared';
import type { AffineResult, CheckBoundaryResult } from '../definitions/checkBoundary';
import { evaluateExpression } from './evaluateDecisionExpression';
import { evaluateDecisionCheck } from './evaluateDecisionCheck';

/** 只解一个输入的仿射边界；不拿几个采样点猜测一般模型的可行区间。 */
function affine(expression: DecisionExpression, inputId: string, model: DecisionModel): AffineResult {
  if ('input' in expression && expression.input === inputId) {
    return { status: 'available', coefficient: 1, constant: 0 };
  }
  if ('literal' in expression || 'input' in expression) {
    const result = evaluateExpression(expression, model);
    return result.status === 'available'
      ? { status: 'available', coefficient: 0, constant: result.value } : result;
  }
  const left = affine(expression.left, inputId, model);
  const right = affine(expression.right, inputId, model);
  if (left.status === 'unavailable') return left;
  if (right.status === 'unavailable') return right;
  let coefficient: number;
  let constant: number;
  if (expression.op === 'add' || expression.op === 'subtract') {
    const sign = expression.op === 'add' ? 1 : -1;
    coefficient = left.coefficient + sign * right.coefficient;
    constant = left.constant + sign * right.constant;
  } else if (expression.op === 'multiply') {
    if (left.coefficient !== 0 && right.coefficient !== 0) {
      return { status: 'unavailable', reason: 'Nonlinear multiplication is not supported for a single boundary.' };
    }
    coefficient = left.coefficient * right.constant + right.coefficient * left.constant;
    constant = left.constant * right.constant;
  } else {
    if (right.coefficient !== 0) {
      return { status: 'unavailable', reason: 'A variable denominator is not supported for a single boundary.' };
    }
    if (right.constant === 0) return { status: 'unavailable', reason: 'Division by zero.' };
    coefficient = left.coefficient / right.constant;
    constant = left.constant / right.constant;
  }
  return Number.isFinite(coefficient) && Number.isFinite(constant)
    ? { status: 'available', coefficient, constant }
    : { status: 'unavailable', reason: 'Non-finite boundary calculation.' };
}

export function deriveCheckBoundary(
  model: DecisionModel,
  check: DecisionModel['checks'][number],
  inputId: string,
): CheckBoundaryResult {
  const input = model.inputs.find(item => item.id === inputId);
  if (!input || input.status === 'withdrawn' || (input.value !== null && typeof input.value !== 'number')) {
    return { status: 'unavailable', reason: `Input ${inputId} is missing, withdrawn or non-numeric.` };
  }
  if (check.operator === 'is') {
    if (check.inputId === inputId) return { status: 'unavailable', reason: 'A discrete condition has no numeric affine boundary.' };
    const result = evaluateDecisionCheck(check, model);
    if (result.left.status === 'unavailable') return result.left;
    return { status: 'independent', passes: result.left.value === check.value };
  }
  const difference = affine({ op: 'subtract', left: check.left, right: check.right }, inputId, model);
  if (difference.status === 'unavailable') return difference;
  const { coefficient, constant } = difference;
  if (coefficient === 0) {
    const passes = check.operator === 'lte' ? constant <= 0
      : check.operator === 'gte' ? constant >= 0 : constant === 0;
    return { status: 'independent', passes };
  }
  const threshold = -constant / coefficient;
  if (!Number.isFinite(threshold)) return { status: 'unavailable', reason: 'Non-finite boundary calculation.' };
  const operator = coefficient > 0 || check.operator === 'eq' ? check.operator
    : check.operator === 'lte' ? 'gte' : 'lte';
  return { status: 'available', operator, value: threshold === 0 ? 0 : threshold };
}
