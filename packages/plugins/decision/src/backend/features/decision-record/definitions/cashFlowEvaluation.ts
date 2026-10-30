/** 已求值的收付款；顺序由时点投影决定，不能由金额正负暗示方向。 */
export interface ResolvedCashFlowAmount {
  readonly id: string;
  readonly direction: 'inflow' | 'outflow' | 'release_reserve' | 'pay_reserve';
  readonly amount: number;
}

export type CashFlowBalanceResult = {
  readonly status: 'available';
  readonly balances: readonly { readonly entryId: string; readonly bank: number; readonly reserve: number; readonly balance: number }[];
  readonly endingBank: number;
  readonly endingReserve: number;
  readonly minimumBalance: number;
  readonly endingBalance: number;
  readonly shortfall: number;
} | { readonly status: 'unavailable'; readonly reason: string };

export interface AffineCashFlowNode extends ResolvedCashFlowAmount {
  readonly coefficient: number;
  readonly constant: number;
  readonly declarationIndex: number;
}

export const cashFlowDirectionOrder = { outflow: 0, pay_reserve: 0, inflow: 1, release_reserve: 2 } as const;
export const cashFlowDirectionLabel = { outflow: '普通支付', pay_reserve: '支付对应隔离义务', inflow: '实际入账', release_reserve: '准备解禁' } as const;
