import type { DecisionModel, DecisionCheck, DecisionCashFlow } from '../../../../shared';

/** 派生付款检查只存在于程序投影中，不进入作者的JSON合同。 */
export type ComputedDecisionCheck = DecisionCheck | {
  id: string; optionId: string; label: string; operator: 'cash_flow_funded'; cashFlowId: string;
};
export type ComputedDecisionModel = Omit<DecisionModel, 'checks'> & {
  checks: ComputedDecisionCheck[]; cashFlows: DecisionCashFlow[];
};
