import type { ComputedDecisionModel } from '../definitions/computedDecisionModel';
import type { DecisionCashFlow } from '../../../../shared';
import { evaluateExpression } from './evaluateDecisionExpression';

/** 普通收付款的充分条件：已有现金覆盖全部支出时，未知收入日期不影响资金可行性。
 * 准备的释放/支付另有顺序约束，仍交给完整逐节点求值，不用这个证明替代。
 */
export function projectOpeningPaymentCoverage(model: ComputedDecisionModel, flow: DecisionCashFlow) {
  if (!('bank' in flow.opening) || flow.entries.some(entry => entry.direction !== 'outflow' && entry.direction !== 'inflow')) return null;
  const bank = evaluateExpression(flow.opening.bank, model);
  const reserve = evaluateExpression(flow.opening.reserve, model);
  if (bank.status !== 'available' || reserve.status !== 'available' || reserve.value < 0) return null;
  let required = 0;
  for (const entry of flow.entries) {
    const amount = evaluateExpression(entry.amount, model);
    if (amount.status === 'available' && amount.value < 0) return null;
    if (entry.direction !== 'outflow') continue;
    if (amount.status !== 'available') return null;
    required += amount.value;
  }
  const available = bank.value - reserve.value;
  if (!Number.isFinite(required) || required > available) return null;
  return { available, required, remaining: available - required,
    text: `${flow.label}：期初银行减隔离准备为 ${available} ${flow.unit}，覆盖全部已登记支付 ${required} ${flow.unit}；不依赖未来收款或其日期，资金检查通过。` };
}
