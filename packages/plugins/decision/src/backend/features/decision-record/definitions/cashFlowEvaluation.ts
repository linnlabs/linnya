/** 已求值的收付款；顺序由时点投影决定，不能由金额正负暗示方向。 */
export interface ResolvedCashFlowAmount {
  readonly id: string;
  readonly direction: 'inflow' | 'outflow';
  readonly amount: number;
}

export type CashFlowBalanceResult = {
  readonly status: 'available';
  readonly balances: readonly { readonly entryId: string; readonly balance: number }[];
  readonly minimumBalance: number;
  readonly endingBalance: number;
  readonly shortfall: number;
} | { readonly status: 'unavailable'; readonly reason: string };

export interface AffineCashFlowNode extends ResolvedCashFlowAmount {
  readonly coefficient: number;
  readonly constant: number;
  readonly declarationIndex: number;
}
