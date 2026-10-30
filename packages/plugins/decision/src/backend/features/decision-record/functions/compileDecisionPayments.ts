import type { DecisionModel, DecisionCashFlow } from '../../../../shared';
import type { ComputedDecisionModel } from '../definitions/computedDecisionModel';
import { DecisionFailure } from '../definitions/decisionFailure';
import { evaluateExpression } from './evaluateDecisionExpression';

/** 责任是持久真源，现金表与检查每次重建，避免作者更新总额却留下另一份尾款。 */
export function compileDecisionPayments(model: DecisionModel): ComputedDecisionModel {
  const obligations = new Map(model.obligations.map(item => [item.id, item]));
  if (obligations.size !== model.obligations.length) throw new DecisionFailure('invalid_model', 'Duplicate obligation id.');
  for (const item of model.obligations) {
    const ids = [...item.installments.map(part => part.id), item.final.id];
    if (new Set(ids).size !== ids.length) throw new DecisionFailure('invalid_model', `Duplicate installment in ${item.id}.`);
  }
  const cashFlows: DecisionCashFlow[] = [];
  for (const option of model.options) {
    const refs = option.obligationIds;
    if (refs === null || refs.length === 0) continue;
    if (new Set(refs).size !== refs.length) throw new DecisionFailure('invalid_model', `Duplicate obligation reference in ${option.id}.`);
    const funds = model.funds;
    if (!funds) throw new DecisionFailure('invalid_model', 'Referenced obligations require funds: bank, reserve, unit and timeAnchor.');
    cashFlows.push({ id: `funding:${option.id}`, label: `${option.label}的资金`, optionId: option.id,
      unit: funds.unit, timeAnchor: funds.timeAnchor, opening: { bank: funds.bank, reserve: funds.reserve },
      entries: refs.flatMap(ref => {
        const item = obligations.get(ref);
        if (!item) throw new DecisionFailure('invalid_model', `Unknown obligation ${ref} in ${option.id}.`);
        return [
          ...item.installments.map(part => ({ id: `${ref}:${part.id}`, label: `${item.label}／${part.label}`, direction: item.direction, amount: { literal: part.amount }, at: part.at })),
          { id: `${ref}:${item.final.id}`, label: `${item.label}／${item.final.label}`, direction: item.direction,
            amount: { op: 'subtract' as const, left: item.total, right: { literal: item.installments.reduce((sum, part) => sum + part.amount, 0) } }, at: item.final.at },
        ];
      }),
    });
  }
  return { ...model, cashFlows, checks: [...model.checks, ...cashFlows.map(flow => ({
    id: flow.id, optionId: flow.optionId, label: flow.label, operator: 'cash_flow_funded' as const, cashFlowId: flow.id,
  }))] };
}

/** 金额守恒还要求尾款非负；情景越过已付分期时不能发布那个边界。 */
export function paymentConservationFailure(model: Pick<DecisionModel, 'inputs' | 'options' | 'obligations'>): string | null {
  const used = new Set(model.options.flatMap(option => option.obligationIds ?? []));
  for (const item of model.obligations.filter(item => used.has(item.id))) {
    const total = evaluateExpression(item.total, model);
    const prefix = item.installments.reduce((sum, part) => sum + part.amount, 0);
    if (total.status === 'available' && total.value < prefix) return `${item.label}总额小于已列分期 ${prefix}，尾款将为负。`;
  }
  return null;
}
