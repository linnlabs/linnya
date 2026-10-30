import type { DecisionCashFlow } from '../../../../shared';
import { collectExpressionInputs } from './evaluateDecisionExpression';

/** 同一份金额依赖用于求值、时点求解及选项检查，避免漏掉隔离准备。 */
export function cashFlowAmountExpressions(flow: DecisionCashFlow) {
  const opening = 'unclassified' in flow.opening ? [flow.opening.unclassified] : [flow.opening.bank, flow.opening.reserve];
  return [...opening, ...flow.entries.map(entry => entry.amount)];
}

export function cashFlowExpressions(flow: DecisionCashFlow) {
  return [...cashFlowAmountExpressions(flow), ...flow.entries.flatMap(entry => entry.at === null ? [] : [entry.at])];
}

export function cashFlowInputIds(flow: DecisionCashFlow): readonly string[] {
  return [...new Set(cashFlowExpressions(flow).flatMap(collectExpressionInputs))];
}
