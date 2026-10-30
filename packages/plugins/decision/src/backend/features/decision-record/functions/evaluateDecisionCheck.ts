import type { ComputedDecisionModel, ComputedDecisionCheck } from '../definitions/computedDecisionModel';
import type { CheckValueResult, DecisionCheckEvaluation } from '../definitions/decisionEvaluation';
import { collectExpressionInputs, evaluateExpression } from './evaluateDecisionExpression';
import { cashFlowInputIds } from './cashFlowExpressions';
import { evaluateCashFlow } from './evaluateCashFlow';

export function collectCheckInputs(check: ComputedDecisionCheck, model: ComputedDecisionModel): readonly string[] {
  if (check.operator === 'cash_flow_funded') {
    const flow = model.cashFlows?.find(item => item.id === check.cashFlowId);
    return flow ? cashFlowInputIds(flow) : [];
  }
  return check.operator === 'is' ? [check.inputId]
    : [...new Set([...collectExpressionInputs(check.left), ...collectExpressionInputs(check.right)])];
}

/** 精确匹配不做truthiness/强转：未知、撤回与类型错配均不能冒充已确认false。 */
function readDiscreteValue(check: Extract<ComputedDecisionCheck, { operator: 'is' }>, model: ComputedDecisionModel): CheckValueResult {
  const input = model.inputs.find(item => item.id === check.inputId);
  if (!input || input.status === 'withdrawn' || input.value === null) {
    return { status: 'unavailable', reason: `Input ${check.inputId} is missing, withdrawn or unknown.` };
  }
  const value = input.value;
  if (typeof value !== typeof check.value || (typeof value !== 'string' && typeof value !== 'boolean')) {
    return { status: 'unavailable', reason: `Input ${check.inputId} has type ${typeof value}; expected ${typeof check.value}.` };
  }
  return { status: 'available', value };
}

export function evaluateDecisionCheck(check: ComputedDecisionCheck, model: ComputedDecisionModel): DecisionCheckEvaluation {
  if (check.operator === 'cash_flow_funded') {
    const flow = model.cashFlows?.find(item => item.id === check.cashFlowId);
    const evaluated = flow ? evaluateCashFlow(model, flow) : null;
    const left: CheckValueResult = evaluated?.status === 'available'
      ? { status: 'available', value: evaluated.shortfall }
      : evaluated?.status === 'needs_information' && evaluated.openingCoverage ? { status: 'available', value: 0 }
        : { status: 'unavailable', reason: evaluated?.text ?? '付款表不存在。' };
    return { id: check.id, optionId: check.optionId, label: check.label, left,
      right: { status: 'available', value: 0 }, passes: left.status === 'available' ? left.value === 0 : null };
  }
  if (check.operator === 'is') {
    const left = readDiscreteValue(check, model);
    return { id: check.id, optionId: check.optionId, label: check.label, left,
      right: { status: 'available', value: check.value },
      passes: left.status === 'available' ? left.value === check.value : null };
  }
  const left = evaluateExpression(check.left, model);
  const right = evaluateExpression(check.right, model);
  const passes = left.status !== 'available' || right.status !== 'available' ? null
    : check.operator === 'lte' ? left.value <= right.value
    : check.operator === 'gte' ? left.value >= right.value : left.value === right.value;
  return { id: check.id, optionId: check.optionId, label: check.label, left, right, passes };
}
