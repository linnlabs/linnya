import type Database from 'better-sqlite3';
import { z } from 'zod';
import { TokenLedgerEntry } from '@linnlabs/linnkit/contracts';
import { tokenAccounting } from '@linnlabs/linnkit/runtime-kernel';

const count = z.number().int().nonnegative();

/** v69 及以前写入的恢复账本形状；只在本迁移中解析，运行时代码不再读取。 */
const RunCostStateV69Schema = z
  .object({
    tokensInput: count,
    tokensOutput: count,
    latencyMs: z.number().nonnegative(),
    llmCallCount: count,
    tokenLedgerEntries: z.array(TokenLedgerEntry),
    tokenLedgerSequence: count,
    contextLedgerSequence: count,
    computedCostUsd: z.number().nonnegative(),
    computedActualCostCount: count,
    unknownActualCostCount: count,
    childRunIds: z.array(z.string()),
    parentRunId: z.string().optional(),
    uncertainExecutions: z.array(z.string()),
  })
  .strict();

const BATCH_SIZE = 64;

/**
 * v69→v70：运行成本恢复账本只保留累计合计与条目 ID。
 *
 * 旧账本把每次 context build 的全部上下文分项（每条消息一项）逐条保存，长运行的账本随调用次数
 * 平方增长：2026-11 开发库 1,546 行平均 585KB、最大 19.4MB。合计与对全部条目聚合的结果相同，
 * 快照和恢复只读合计，逐条分项不再需要。旧行全部改写为新形状，运行时代码不双读旧形状。
 */
export function migrateV69ToV70RunCostLedgerTotals(db: Database.Database): void {
  const select = db.prepare<[string, number], { run_id: string; state_json: string }>(
    'SELECT run_id, state_json FROM agent_run_costs WHERE run_id > ? ORDER BY run_id LIMIT ?'
  );
  const update = db.prepare('UPDATE agent_run_costs SET state_json = ? WHERE run_id = ?');
  let cursor = '';
  for (;;) {
    const rows = select.all(cursor, BATCH_SIZE);
    if (rows.length === 0) return;
    for (const row of rows) {
      const { tokenLedgerEntries, ...rest } = RunCostStateV69Schema.parse(
        JSON.parse(row.state_json)
      );
      const next = {
        ...rest,
        tokenLedgerAggregate: tokenAccounting.aggregateTokenLedgerEntries(tokenLedgerEntries),
        tokenLedgerEntryIds: tokenLedgerEntries.map(entry => entry.id),
      };
      update.run(JSON.stringify(next), row.run_id);
    }
    cursor = rows[rows.length - 1]!.run_id;
  }
}
