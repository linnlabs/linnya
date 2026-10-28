import type { DecisionExpression, DecisionModel } from '../../../shared';

const input = (id: string): DecisionExpression => ({ input: id });
const sum = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'add', left, right });
const difference = (left: DecisionExpression, right: DecisionExpression): DecisionExpression => ({ op: 'subtract', left, right });

/** 合成资金反例：总价、未来现金流与支出限额是不同量，均非实际成交/银行余额。 */
export function refundableOrderModel(): DecisionModel {
  const orderTotal = sum(sum(input('c1_total'), input('c2_total')), input('c3_total'));
  const futureCollection = sum(difference(orderTotal, input('held_deposits')), input('refund_before_collection'));
  const budgetUse = sum(sum(input('spent'), input('supplier_quote')), input('extra_fees'));
  return {
    title: '合成小批订单核对', question: '是否值得继续核对成本与付款条件？',
    inputs: [
      { id: 'c1_total', label: '客户1总成交意向，含订金', kind: 'fact', value: 100, unit: 'CNY/本批', origin: '合成用户表态，余款未付、未成交', status: 'available' },
      { id: 'c2_total', label: '客户2总成交意向，含订金', kind: 'fact', value: 90, unit: 'CNY/本批', origin: '合成用户表态，余款未付、未成交', status: 'available' },
      { id: 'c3_total', label: '客户3总成交意向，含订金', kind: 'fact', value: 120, unit: 'CNY/本批', origin: '合成用户表态，余款未付、未成交', status: 'available' },
      { id: 'held_deposits', label: '已持可退订金总额', kind: 'fact', value: 150, unit: 'CNY/本批', origin: '合成用户，三位各50，须留作退款', status: 'available' },
      { id: 'refund_before_collection', label: '假设先退再全额收取的退款额', kind: 'assumption', value: 0, unit: 'CNY/本批', origin: '默认假设抵扣订金；先退再收情景为150，尚未发生', status: 'available' },
      { id: 'spent', label: '此前试验已支出', kind: 'fact', value: 180, unit: 'CNY/全程', origin: '合成用户报告的沉没支出', status: 'available' },
      { id: 'spending_limit', label: '用户全程支出限额', kind: 'constraint', value: 1000, unit: 'CNY/全程', origin: '合成用户，包含此前180；不是银行现金余额', status: 'available' },
      { id: 'supplier_quote', label: '供应商报价，未下单未付', kind: 'fact', value: 300, unit: 'CNY/本批', origin: '合成报价，附加费未知', status: 'available' },
      { id: 'extra_fees', label: '全部附加费', kind: 'fact', value: null, unit: 'CNY/本批', origin: '运费税费范围尚未核明', status: 'available' },
    ],
    options: [{ id: 'proceed', label: '条件核清后再考虑下单', description: '预算检查只是可行条件之一，不是授权' }, { id: 'wait', label: '暂缓承诺', description: '核对成本和付款安排，不自动放弃' }],
    calculations: [
      { id: 'intended_total', label: '总成交意向，非已实现收入', unit: 'CNY/本批', expression: orderTotal },
      { id: 'future_collection', label: '假设交易完成可再收取，非已收现金', unit: 'CNY/本批', expression: futureCollection },
      { id: 'refund_outflow', label: '假设先退再收的退款流出', unit: 'CNY/本批', expression: input('refund_before_collection') },
      { id: 'net_future_customer_flow', label: '潜在未来客户净流入，不含供应商支付', unit: 'CNY/本批', expression: difference(futureCollection, input('refund_before_collection')) },
      { id: 'quote_only_gap', label: '意向总价减报价的差额，未扣附加费非利润', unit: 'CNY/本批', expression: difference(orderTotal, input('supplier_quote')) },
      { id: 'incremental_gap', label: '假设全部成交后的增量差额，未含其他遗漏项', unit: 'CNY/本批', expression: difference(difference(orderTotal, input('supplier_quote')), input('extra_fees')) },
      { id: 'spending_allowance', label: '全程支出限额减已支出，不是现金余额', unit: 'CNY/全程', expression: difference(input('spending_limit'), input('spent')) },
      { id: 'total_spending', label: '含既往试验及假设采购的全程支出', unit: 'CNY/全程', expression: budgetUse },
    ],
    checks: [{ id: 'spending_cap', optionId: 'proceed', label: '已声明全程支出不超过上限', left: budgetUse, operator: 'lte', right: input('spending_limit') }],
  };
}
