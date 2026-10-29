import type { DecisionModel } from '../../../../shared';
import { DecisionFailure } from '../definitions/decisionFailure';
import { collectExpressionInputs, evaluateExpression } from './evaluateDecisionExpression';

export function validateDecisionCashFlows(model: DecisionModel): void {
  const ids = model.cashFlows?.map(flow => flow.id) ?? [];
  if (new Set(ids).size !== ids.length) throw new DecisionFailure('invalid_model', 'Duplicate cash flow id.');
  for (const flow of model.cashFlows ?? []) {
    if (!model.options.some(option => option.id === flow.optionId)) throw new DecisionFailure('invalid_model', `Unknown cash flow option: ${flow.optionId}`);
    if (new Set(flow.entries.map(entry => entry.id)).size !== flow.entries.length) throw new DecisionFailure('invalid_model', `Duplicate payment entry in ${flow.id}`);
    for (const expression of [flow.openingBalance, ...flow.entries.map(entry => entry.amount)]) {
      for (const id of collectExpressionInputs(expression)) {
        const input = model.inputs.find(input => input.id === id);
        if (!input) throw new DecisionFailure('invalid_model', `Cash flow ${flow.id}: unknown input ${id}.`);
      }
    }
  }
}

/** 收款在它自己的节点才加入余额；期末正数不能抹掉先前资金缺口。 */
export function evaluateDecisionCashFlows(model: DecisionModel) {
  return (model.cashFlows ?? []).map(flow => {
    const opening = evaluateExpression(flow.openingBalance, model);
    const entries = flow.entries.map(entry => ({ ...entry, result: evaluateExpression(entry.amount, model) }));
    const inputIds = [...new Set([flow.openingBalance, ...flow.entries.map(entry => entry.amount)].flatMap(collectExpressionInputs))];
    const missingInputIds = inputIds.filter(id => {
      const input = model.inputs.find(input => input.id === id);
      return input?.value === null || input?.status === 'withdrawn';
    });
    const common = { id: flow.id, label: flow.label, optionId: flow.optionId, unit: flow.unit, inputIds, opening, entries };
    const unresolved = { ...common, status: missingInputIds.length ? 'needs_information' as const : 'unavailable' as const,
        missingInputIds, minimumBalance: null, endingBalance: null, shortfall: null,
        text: `${flow.label}：${missingInputIds.length ? `需要信息：${missingInputIds.join(', ')}` : '算式不可用'}；未把未知期初或付款额当零。` };
    if (opening.status === 'unavailable') return unresolved;
    let balance = opening.value;
    let minimumBalance = balance;
    const balances: { entryId: string; balance: number }[] = [];
    for (const entry of entries) {
      if (entry.result.status === 'unavailable') return unresolved;
      if (entry.result.value < 0) {
        return { ...common, status: 'unavailable' as const, missingInputIds: [], minimumBalance: null, endingBalance: null, shortfall: null,
          text: `${flow.label}：${entry.id}金额为负；用非负金额及inflow/outflow明确方向。` };
      }
      balance += entry.direction === 'inflow' ? entry.result.value : -entry.result.value;
      if (!Number.isFinite(balance)) return { ...common, status: 'unavailable' as const, missingInputIds: [], minimumBalance: null, endingBalance: null, shortfall: null, text: `${flow.label}：余额超出有限数范围。` };
      minimumBalance = Math.min(minimumBalance, balance);
      balances.push({ entryId: entry.id, balance });
    }
    const shortfall = Math.max(0, -minimumBalance);
    return { ...common, status: 'available' as const, missingInputIds: [], balances, minimumBalance, endingBalance: balance, shortfall,
      text: `${flow.label}：按声明顺序最低可动用余额 ${minimumBalance} ${flow.unit}，资金缺口 ${shortfall} ${flow.unit}，期末余额 ${balance} ${flow.unit}；这是现金时序，不是利润或到账认证。` };
  });
}
