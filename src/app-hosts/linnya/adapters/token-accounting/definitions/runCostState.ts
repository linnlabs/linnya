import { z } from 'zod';
import { TokenLedgerEntry } from '@linnlabs/linnkit/contracts';

const count = z.number().int().nonnegative();
/** 最小恢复账本，不保存 prompt、响应正文或 Telemetry payload。 */
export const RunCostStateSchema = z
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
export type RunCostState = z.infer<typeof RunCostStateSchema>;
export interface RunCostStateStore {
  load(runId: string): RunCostState | null;
  save(runId: string, state: RunCostState): void;
}
