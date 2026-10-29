import type { CashFlowBalanceResult, ResolvedCashFlowAmount } from '../definitions/cashFlowEvaluation';

/** 最低点包含期初和每个付款节点，避免期末收款掩盖中途缺口。 */
export function calculateCashFlowBalances(opening: number, entries: readonly ResolvedCashFlowAmount[]): CashFlowBalanceResult {
  let balance = opening;
  let minimumBalance = balance;
  const balances: { entryId: string; balance: number }[] = [];
  for (const entry of entries) {
    if (entry.amount < 0) return { status: 'unavailable', reason: `${entry.id}金额为负；用非负金额及inflow/outflow明确方向。` };
    balance += entry.direction === 'inflow' ? entry.amount : -entry.amount;
    if (!Number.isFinite(balance)) return { status: 'unavailable', reason: '余额超出有限数范围。' };
    minimumBalance = Math.min(minimumBalance, balance);
    balances.push({ entryId: entry.id, balance });
  }
  return { status: 'available', balances, minimumBalance, endingBalance: balance, shortfall: Math.max(0, -minimumBalance) };
}
