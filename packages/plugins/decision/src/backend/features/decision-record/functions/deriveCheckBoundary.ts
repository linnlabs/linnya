import type { DecisionModel } from '../../../../shared';
import type { CheckBoundaryResult } from '../definitions/checkBoundary';
import { deriveAffineExpression } from './deriveAffineExpression';
import { collectCheckInputs, evaluateDecisionCheck } from './evaluateDecisionCheck';
export function deriveCheckBoundary(
  model: DecisionModel,
  check: DecisionModel['checks'][number],
  inputId: string,
): CheckBoundaryResult {
  const input = model.inputs.find(item => item.id === inputId);
  if (!input || input.status === 'withdrawn' || (input.value !== null && typeof input.value !== 'number')) {
    return { status: 'unavailable', reason: `Input ${inputId} is missing, withdrawn or non-numeric.` };
  }
  if (check.operator === 'cash_flow_funded') {
    if (collectCheckInputs(check, model).includes(inputId)) return { status: 'unavailable', reason: '现金时序含分段最低余额，请查看付款表时点门槛或登记情景重算。' };
    const evaluated = evaluateDecisionCheck(check, model);
    return evaluated.passes === null ? { status: 'unavailable', reason: '付款表需要信息或模型不可用。' } : { status: 'independent', passes: evaluated.passes };
  }
  if (check.operator === 'is') {
    if (check.inputId === inputId) return { status: 'unavailable', reason: 'A discrete condition has no numeric affine boundary.' };
    const result = evaluateDecisionCheck(check, model);
    if (result.left.status === 'unavailable') return result.left;
    return { status: 'independent', passes: result.left.value === check.value };
  }
  const difference = deriveAffineExpression({ op: 'subtract', left: check.left, right: check.right }, inputId, model);
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
