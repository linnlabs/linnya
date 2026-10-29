import type { DecisionModel, DecisionCashFlow } from '../../../../shared';
import { collectExpressionInputs, evaluateExpression } from './evaluateDecisionExpression';
import { calculateCashFlowBalances } from './calculateCashFlowBalances';

/** 只投影一张表，供当前求值及时间边界共用；不会递归重算其他边界。 */
export function evaluateCashFlow(model: DecisionModel, flow: DecisionCashFlow) {
  const opening = evaluateExpression(flow.openingBalance, model);
  const entries = flow.entries.map((entry, index) => ({ ...entry, declarationIndex: index,
    result: evaluateExpression(entry.amount, model),
    time: entry.at === null ? { status: 'unavailable' as const, reason: '节点时点未知。' } : evaluateExpression(entry.at, model),
  }));
  const inputIds = [...new Set([flow.openingBalance, ...flow.entries.flatMap(entry => entry.at === null ? [entry.amount] : [entry.amount, entry.at])].flatMap(collectExpressionInputs))];
  const missingInputIds = inputIds.filter(id => {
    const input = model.inputs.find(input => input.id === id);
    return input?.value === null || input?.status === 'withdrawn';
  });
  const missingTimingIds = flow.entries.filter(entry => entry.at === null).map(entry => entry.id);
  const needsInformation = flow.timeAnchor === null || missingTimingIds.length > 0 || missingInputIds.length > 0;
  const common = { id: flow.id, label: flow.label, optionId: flow.optionId, unit: flow.unit, timeAnchor: flow.timeAnchor,
    inputIds, opening, entries };
  const unresolved = { ...common, status: needsInformation ? 'needs_information' as const : 'unavailable' as const,
    missingInputIds, missingTimingIds, minimumBalance: null, endingBalance: null, shortfall: null,
    text: `${flow.label}：${needsInformation ? `需要信息（${[...(flow.timeAnchor === null ? ['时间锚点'] : []), ...missingTimingIds, ...missingInputIds].join(', ')}）` : '金额或时点算式不可用'}；未将未知当零或按原数组猜日期。` };
  if (needsInformation || opening.status === 'unavailable') return unresolved;
  const resolved: (typeof entries[number] & { amountValue: number; day: number })[] = [];
  for (const entry of entries) {
    if (entry.result.status !== 'available' || entry.time.status !== 'available') return unresolved;
    resolved.push({ ...entry, amountValue: entry.result.value, day: entry.time.value });
  }
  // 同一天不假定客户先付款，流出先于流入；同方向保留声明顺序使逐节点回执稳定。
  resolved.sort((a, b) => a.day - b.day || (a.direction === b.direction ? a.declarationIndex - b.declarationIndex : a.direction === 'outflow' ? -1 : 1));
  const result = calculateCashFlowBalances(opening.value, resolved.map(entry => ({ id: entry.id, direction: entry.direction, amount: entry.amountValue })));
  if (result.status === 'unavailable') return { ...unresolved, status: 'unavailable' as const, text: `${flow.label}：${result.reason}` };
  return { ...common, ...result, entries: resolved, missingInputIds: [], missingTimingIds: [],
    text: `${flow.label}：按相对“${flow.timeAnchor}”的天数排序、同日先付后收，最低可动用余额 ${result.minimumBalance} ${flow.unit}，资金缺口 ${result.shortfall} ${flow.unit}，期末余额 ${result.endingBalance} ${flow.unit}；不认证到账或合同完整性。` };
}
