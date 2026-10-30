import type { DecisionCashFlow } from '../../../../shared';
import type { ComputedDecisionModel } from '../definitions/computedDecisionModel';
import { evaluateCashFlow } from './evaluateCashFlow';

/** 放行条件跟随逐节点余额；未知入账不提前计入，缺失项沿原标识披露。 */
export function projectCashFundingConditions(model: ComputedDecisionModel, flow: DecisionCashFlow, result: ReturnType<typeof evaluateCashFlow>): string[] {
  if (result.status === 'available') {
    let required = 0;
    return result.balances.flatMap((balance, index) => {
      const shortfall = Math.max(0, -balance.balance);
      if (shortfall <= required) return [];
      required = shortfall;
      const entry = result.entries[index];
      const date = entry.time.status === 'available' ? `（距“${flow.timeAnchor}”${entry.time.value}天）` : '';
      return [`${flow.label}：最迟在支付“${entry.label}”${date}之前，累计需额外实际到账 ${shortfall} ${flow.unit}；承诺未到账不计入，同日按先付后收。`];
    });
  }
  if (result.status === 'unavailable') return [`${flow.label}：先修正金额或时点模型；${result.text}`];
  const missing = [
    ...(flow.timeAnchor === null ? ['时间锚点'] : []),
    ...result.missingTimingIds.map(id => `${flow.entries.find(entry => entry.id === id)?.label ?? id}的实际收付日期`),
    ...result.missingInputIds.map(id => `${model.inputs.find(input => input.id === id)?.label ?? id}（${id}）`),
  ];
  if (result.openingCoverage) return [result.openingCoverage.text, `${flow.label}：时序明细仍待补齐：${missing.join('；')}；这不影响现有现金覆盖已登记支付的结论。`];
  // 未知收款只作零入账的条件核算，仍保持needs_information，不能变成批准或事实。
  const knownPayments = flow.entries.filter(entry => entry.direction === 'outflow' || entry.direction === 'pay_reserve');
  const paymentProjection = evaluateCashFlow(model, { ...flow, entries: knownPayments });
  const amounts = result.entries.filter(entry => entry.direction === 'outflow' && entry.result.status === 'available');
  const total = amounts.reduce((sum, entry) => sum + (entry.result.status === 'available' ? entry.result.value : 0), 0);
  const allAmountsKnown = amounts.length === flow.entries.filter(entry => entry.direction === 'outflow').length;
  const gap = result.openingBank.status === 'available' && result.openingReserve.status === 'available' && allAmountsKnown
    ? Math.max(0, total - (result.openingBank.value - result.openingReserve.value)) : null;
  return [
    `${flow.label}：需要信息：${missing.join('；') || result.text}。补齐后重算放行条件。`,
    ...(paymentProjection.status === 'available' ? projectCashFundingConditions(model, { ...flow, entries: knownPayments }, paymentProjection).map(text => `未计未确认收款与准备解禁时，${text}`)
      : gap !== null && gap > 0 ? [`${flow.label}：未计收款与准备解禁，已知普通付款合计 ${total} ${flow.unit}，付清这些款项前至少还需实际到账 ${gap} ${flow.unit}；具体最晚付款节点须待日期补齐。`] : []),
  ];
}
