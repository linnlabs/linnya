import type { CashFlowBalanceResult, ResolvedCashFlowAmount } from '../definitions/cashFlowEvaluation';

/** 最低点包含期初和每个付款节点，避免期末收款掩盖中途缺口。 */
export function calculateCashFlowBalances(bank: number, reserve: number, entries: readonly ResolvedCashFlowAmount[]): CashFlowBalanceResult {
  if (reserve < 0) return { status: 'unavailable', reason: '期初隔离准备不能为负。' };
  let balance = bank - reserve;
  let minimumBalance = balance;
  const balances: { entryId: string; bank: number; reserve: number; balance: number }[] = [];
  for (const entry of entries) {
    if (entry.amount < 0) return { status: 'unavailable', reason: `${entry.id}金额为负；用非负金额及节点方向表达变化。` };
    if (entry.direction === 'inflow') bank += entry.amount;
    if (entry.direction === 'outflow' || entry.direction === 'pay_reserve') bank -= entry.amount;
    // 对应准备已扣过可用额，实际支付同时结清该义务，不能再扣一次可用额。
    if (entry.direction === 'release_reserve' || entry.direction === 'pay_reserve') reserve -= entry.amount;
    if (reserve < 0) return { status: 'unavailable', reason: `${entry.id}释放或支付的准备超过现存隔离准备。` };
    balance = bank - reserve;
    if (!Number.isFinite(bank) || !Number.isFinite(balance)) return { status: 'unavailable', reason: '余额超出有限数范围。' };
    minimumBalance = Math.min(minimumBalance, balance);
    balances.push({ entryId: entry.id, bank, reserve, balance });
  }
  return { status: 'available', balances, minimumBalance, endingBank: bank, endingReserve: reserve, endingBalance: balance, shortfall: Math.max(0, -minimumBalance) };
}
