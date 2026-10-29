import type { DecisionExpression, DecisionModel } from '../../../../shared';
import type { AffineResult } from '../definitions/checkBoundary';
import { evaluateExpression } from './evaluateDecisionExpression';

/** 只解一个输入的仿射边界；不拿几个采样点猜测一般模型的可行区间。 */
export function deriveAffineExpression(expression: DecisionExpression, inputId: string, model: DecisionModel): AffineResult {
  if ('input' in expression && expression.input === inputId) {
    return { status: 'available', coefficient: 1, constant: 0 };
  }
  if ('literal' in expression || 'input' in expression) {
    const result = evaluateExpression(expression, model);
    return result.status === 'available'
      ? { status: 'available', coefficient: 0, constant: result.value } : result;
  }
  const left = deriveAffineExpression(expression.left, inputId, model);
  const right = deriveAffineExpression(expression.right, inputId, model);
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

