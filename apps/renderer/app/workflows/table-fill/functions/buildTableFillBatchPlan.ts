import { SubrunBatchArgsSchema, PromptKeys } from '@app/schemas';
import type { TableFillRowPlan } from '@/domains/editor/features/table-fill-write';
import type { TableFillBatchPlan } from '../definitions/tableFillWorkflow';

export interface BuildTableFillBatchPlanOptions {
  createUnitId(row: TableFillRowPlan): string;
  createSubrunId(row: TableFillRowPlan): string;
  describeRow(row: TableFillRowPlan): string;
}

export function buildTableFillBatchPlan(
  rows: readonly TableFillRowPlan[],
  options: BuildTableFillBatchPlanOptions,
): TableFillBatchPlan {
  const identities = rows.map((row) => ({
    row,
    unitId: options.createUnitId(row),
    subrunId: options.createSubrunId(row),
  }));
  const args = SubrunBatchArgsSchema.parse({
    worker_prompt_key: PromptKeys.TABLE_AI_FILL,
    subruns: identities.map(({ row, unitId, subrunId }) => ({
      unit_id: unitId,
      subrun_id: subrunId,
      description: options.describeRow(row),
      prompt: row.prompt,
    })),
  });

  return {
    args,
    unitIds: new Set(args.subruns.map((subrun) => subrun.unit_id)),
    unitIdBySubrunId: new Map(args.subruns.map((subrun) => [subrun.subrun_id, subrun.unit_id])),
    writeTargets: identities.map(({ row, unitId }) => ({
      unitId,
      rowIndex: row.rowIndex,
      colIndex: row.colIndex,
      rowContext: row.rowContext,
    })),
  };
}
