import type { LocalCiReceiptFacts, LocalCiRunRecord } from '../definitions/localCiRetention';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 通过的完整回执：干净检出、没有缩小范围、没有失败或中断。
 * 这是对外的回执合同（见 README“结果保留”）：本机工具按同一条件认定回执，修改条件就是修改合同。
 */
export function isPassingFullReceipt(receipt: LocalCiReceiptFacts | null): boolean {
  return receipt?.passed === true && receipt.clean === true && receipt.fullRun === true;
}

export interface LocalCiRetentionPolicy {
  /** 最近这么多个运行目录一律保留。 */
  readonly keepNewest: number;
  /** 这些代码内容（tree）各自最新的一份通过回执一律保留：当前 HEAD 及其他 worktree 的 HEAD。 */
  readonly protectedTrees: readonly string[];
  readonly now: number;
  /** 这个时间窗内开始的通过回执一律保留。 */
  readonly receiptKeepDays: number;
}

/**
 * 选出可以删除的运行目录名。保留规则（满足任一条就保留）：
 *
 * 1. 最近的 `keepNewest` 个运行，不论结果；
 * 2. 每个受保护 tree 最新的一份通过的完整回执；
 * 3. 最近 `receiptKeepDays` 天内开始的所有通过的完整回执。
 *
 * 失败、中断、范围缩小或读不出回执的旧运行只靠第 1 条保留，超出后删除。
 */
export function selectLocalCiRunsToPrune(runs: readonly LocalCiRunRecord[], policy: LocalCiRetentionPolicy): string[] {
  const newestFirst = [...runs].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const keep = new Set(newestFirst.slice(0, Math.max(0, policy.keepNewest)).map(run => run.name));
  const cutoff = policy.now - policy.receiptKeepDays * DAY_MS;
  for (const tree of new Set(policy.protectedTrees)) {
    const newest = newestFirst.find(run => isPassingFullReceipt(run.receipt) && run.receipt?.tree === tree);
    if (newest) keep.add(newest.name);
  }
  for (const run of newestFirst) {
    if (isPassingFullReceipt(run.receipt) && run.startedAtMs >= cutoff) keep.add(run.name);
  }
  return newestFirst.filter(run => !keep.has(run.name)).map(run => run.name);
}
