import type { DecisionModel, DecisionCashFlow } from '../../../../shared';
import { cashFlowDirectionOrder } from '../definitions/cashFlowEvaluation';
import { cashFlowAmountExpressions } from './cashFlowExpressions';
import type { AffineCashFlowNode } from '../definitions/cashFlowEvaluation';
import type { NumericRegion } from '../definitions/optionRange';
import { collectExpressionInputs, evaluateExpression } from './evaluateDecisionExpression';
import { deriveAffineExpression } from './deriveAffineExpression';
import { partitionNumericRegions } from './partitionNumericRegions';
import { calculateCashFlowBalances } from './calculateCashFlowBalances';

/** 全部仿射相遇点已经分割数轴；区域内顺序恒定，不用几个日期采样猜门槛。 */
function compareNodes(a: AffineCashFlowNode, b: AffineCashFlowNode, region: NumericRegion): number {
  const coefficient = a.coefficient - b.coefficient;
  const constant = a.constant - b.constant;
  let order: number;
  if (coefficient === 0) order = Math.sign(constant);
  else {
    const crossing = -constant / coefficient;
    const side = region.lower !== null && region.lower === region.upper ? Math.sign(region.lower - crossing)
      : region.upper !== null && region.upper <= crossing ? -1 : 1;
    order = Math.sign(coefficient) * side;
  }
  return order || cashFlowDirectionOrder[a.direction] - cashFlowDirectionOrder[b.direction] || a.declarationIndex - b.declarationIndex;
}

function rangeText(label: string, region: NumericRegion): string {
  if (region.lower === null && region.upper === null) return `${label}为任意有限天数`;
  if (region.lower === region.upper) return `${label} = ${region.lower}天`;
  return [region.lower === null ? '' : `${label} ${region.lowerInclusive ? '≥' : '>'} ${region.lower}天`,
    region.upper === null ? '' : `${label} ${region.upperInclusive ? '≤' : '<'} ${region.upper}天`].filter(Boolean).join(' 且 ');
}

function projectInputTiming(model: DecisionModel, flow: DecisionCashFlow, inputId: string) {
  const input = model.inputs.find(item => item.id === inputId);
  const common = { inputId, label: input?.label ?? inputId, timeAnchor: flow.timeAnchor,
    fixedInputIds: model.inputs.filter(item => item.id !== inputId).map(item => item.id) };
  const failure = (status: 'needs_information' | 'unavailable', reason: string) => ({ ...common, status,
    zeroShortfallRanges: null, reason, text: `${common.label}的付款时点门槛：${status === 'needs_information' ? '需要信息' : '不可用'}（${reason}）。` });
  if (flow.timeAnchor === null || flow.entries.some(entry => entry.at === null)) return failure('needs_information', '时间锚点或节点时点未知');
  if (!input || input.status === 'withdrawn' || (input.value !== null && typeof input.value !== 'number')) return failure('needs_information', '时点输入未知类型或已撤回');
  if ('unclassified' in flow.opening) return failure('needs_information', '期初未区分银行余额与隔离准备');
  const amountExpressions = cashFlowAmountExpressions(flow);
  if (amountExpressions.some(expression => collectExpressionInputs(expression).includes(inputId))) {
    return failure('unavailable', '该输入同时影响金额或期初；本投影只改变时点，不求金额联动门槛');
  }
  const referenced = [...amountExpressions, ...flow.entries.flatMap(entry => entry.at === null ? [] : [entry.at])].flatMap(collectExpressionInputs);
  const missing = model.inputs.filter(item => referenced.includes(item.id) && item.id !== inputId && (item.value === null || item.status === 'withdrawn'));
  if (missing.length) return failure('needs_information', missing.map(item => item.id).join(', '));
  const bank = evaluateExpression(flow.opening.bank, model);
  const reserve = evaluateExpression(flow.opening.reserve, model);
  if (bank.status !== 'available') return failure('unavailable', bank.reason);
  if (reserve.status !== 'available') return failure('unavailable', reserve.reason);
  const nodes: AffineCashFlowNode[] = [];
  for (const [index, entry] of flow.entries.entries()) {
    if (entry.at === null) return failure('needs_information', entry.id);
    const date = deriveAffineExpression(entry.at, inputId, model);
    const amount = evaluateExpression(entry.amount, model);
    if (date.status !== 'available') return failure('unavailable', date.reason);
    if (amount.status !== 'available') return failure('unavailable', amount.reason);
    nodes.push({ id: entry.id, direction: entry.direction, amount: amount.value, declarationIndex: index,
      coefficient: date.coefficient, constant: date.constant });
  }
  const endpoints: number[] = [];
  for (const [index, a] of nodes.entries()) {
    for (const b of nodes.slice(index + 1)) {
      if (a.coefficient === b.coefficient) continue;
      const crossing = (b.constant - a.constant) / (a.coefficient - b.coefficient);
      if (!Number.isFinite(crossing)) return failure('unavailable', '节点相遇日期超出有限数范围');
      endpoints.push(crossing === 0 ? 0 : crossing);
    }
  }
  const zeroShortfallRanges: NumericRegion[] = [];
  for (const region of partitionNumericRegions(endpoints)) {
    const result = calculateCashFlowBalances(bank.value, reserve.value, [...nodes].sort((a, b) => compareNodes(a, b, region)));
    if (result.status !== 'available') return failure('unavailable', result.reason);
    if (result.shortfall !== 0) continue;
    const last = zeroShortfallRanges[zeroShortfallRanges.length - 1];
    if (last && last.upper === region.lower && (last.upperInclusive || region.lowerInclusive)) {
      zeroShortfallRanges[zeroShortfallRanges.length - 1] = { ...last, upper: region.upper, upperInclusive: region.upperInclusive };
    } else zeroShortfallRanges.push(region);
  }
  return { ...common, status: 'available' as const, zeroShortfallRanges,
    text: `${flow.label}：${zeroShortfallRanges.length ? `${zeroShortfallRanges.map(region => rangeText(common.label, region)).join(' 或 ')}时现金缺口为零` : `只改变${common.label}不能消除现金缺口`}（相对“${flow.timeAnchor}”，其他输入固定，同日先付后收）。` };
}

export function projectCashFlowTiming(model: DecisionModel, flow: DecisionCashFlow) {
  const ids = [...new Set(flow.entries.flatMap(entry => entry.at === null ? [] : collectExpressionInputs(entry.at)))];
  return ids.map(id => projectInputTiming(model, flow, id));
}
