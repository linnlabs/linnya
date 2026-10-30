import type { DecisionExpression, DecisionModel, DecisionRecommendation } from '../../../shared';
const ref = (input: string): DecisionExpression => ({ input });
const subtract = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'subtract', left, right });

/** 合成模型把已到账、受限订金和未来回款分开；口头承诺不改变可用现金。 */
export function deliveryPurchaseModel(funded = false): DecisionModel {
  const available = subtract(ref('bank'), ref('reserve'));
  return {
    title: '采购资金交付', question: '当前是否具备付款资金？',
    inputs: [
      ...[['bank', funded ? 625 : 400], ['reserve', 120], ['total', 505], ['first', 250], ['collection', 440]].map(([id, value]) => ({
        id: String(id), label: String(id), value: Number(value), quantityType: 'money' as const, unit: 'CNY', kind: 'fact' as const, status: 'available' as const, origin: '合成用户事实',
      })),
      { id: 'due', label: '供应商尾款日', value: 0, quantityType: 'duration', unit: '天', kind: 'fact', status: 'available', origin: '交货日' },
      { id: 'received', label: '客户回款日', value: 7, quantityType: 'duration', unit: '天', kind: 'assumption', status: 'available', origin: '第7天最早收到，未到账' },
    ],
    options: [{ obligationIds: ['supplier', 'customer'], id: 'order', label: '订单', description: '仅资金可行性' }, { obligationIds: [], id: 'wait', label: '暂缓', description: '先核对' }],
    calculations: [
      { id: 'available', label: '已到账且扣除退款准备的可动用资金', expression: available, quantityType: 'money', unit: 'CNY' },
      { id: 'gap', label: '回款前差额（负数为缺口）', expression: subtract(available, ref('total')), quantityType: 'money', unit: 'CNY' },
    ],
    checks: [{ id: 'cash', label: '回款前总付款资金', optionId: 'order', left: available, operator: 'gte', right: ref('total') }],
    funds: { bank: ref('bank'), reserve: ref('reserve'), unit: 'CNY', timeAnchor: '交货日' },
    obligations: [
      { id: 'customer', label: '客户回款', direction: 'inflow', total: ref('collection'), installments: [], final: { id: 'collect', label: '未来客户回款', at: ref('received') } },
      { id: 'supplier', label: '采购', direction: 'outflow', total: ref('total'),
        installments: [{ id: 'first', label: '开工首款', amount: 250, at: { literal: -5 } }],
        final: { id: 'rest', label: '总价减首款', at: ref('due') } },
    ],
  };
}
export function deliveryPurchaseAdvice(funded = false): DecisionRecommendation {
  return {
    optionIds: funded ? ['order'] : ['wait'], rationale: funded ? '新增225已到账且可动用，资金检查通过，仍须确认订单条件。' : '尚缺225，未来回款不是当前可用现金。',
    changeConditions: '新增225实际到账且不受退款限制后，再复核付款资金；只有书面承诺不改变现金。',
    nextAction: '先核对实际到账与订单条件，不自动下单。', unresolved: ['履约与执行授权未评估'],
    numericBasis: { calculationIds: ['available', 'gap'], boundaries: [{ checkId: 'cash', inputId: 'bank' }] },
  };
}
