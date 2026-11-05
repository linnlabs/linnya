import { z } from 'zod';
import { TokenLedgerAggregate } from '@linnlabs/linnkit/contracts';

const count = z.number().int().nonnegative();
/**
 * 最小恢复账本，不保存 prompt、响应正文或 Telemetry payload。
 *
 * 只保存本 run 自身账本条目的累计合计与条目 ID。逐条上下文分项（每条消息的 token）
 * 随每次 context build 重复出现，保存它们会让一次长运行的账本随调用次数平方增长；
 * 恢复与快照只需要合计。
 */
export const RunCostStateSchema = z
  .object({
    tokensInput: count,
    tokensOutput: count,
    latencyMs: z.number().nonnegative(),
    llmCallCount: count,
    tokenLedgerAggregate: TokenLedgerAggregate,
    tokenLedgerEntryIds: z.array(z.string()),
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
export type RunCostState = z.infer<typeof RunCostStateSchema>;
export interface RunCostStateStore {
  load(runId: string): RunCostState | null;
  save(runId: string, state: RunCostState): void;
}
