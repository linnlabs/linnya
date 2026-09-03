import {
  readSubrunBatchStructuredResult,
  readWriteToTableReplayResult,
} from '@app/schemas';
import type { SSESubRunTraceEvent, SSEToolOutputEvent } from 'linnkit/contracts';
import type { TableFillWriteCommand } from '@/domains/editor/features/table-fill-write';

const SUBRUN_BATCH_TOOL_NAME = 'subrun_batch';
const WRITE_TO_TABLE_TOOL_NAME = 'write_to_table';

export function readTableFillWriteCommand(params: {
  event: SSESubRunTraceEvent;
  sessionId: string;
  unitIdBySubrunId: ReadonlyMap<string, string>;
}): TableFillWriteCommand | null {
  const { event } = params;
  if (
    event.kind !== 'tool_output'
    || event.tool_name !== WRITE_TO_TABLE_TOOL_NAME
    || event.status !== 'success'
  ) {
    return null;
  }

  // 表格目标由启动前验证过的 batch plan 绑定，开放 metadata 不得决定副作用归属。
  const unitId = params.unitIdBySubrunId.get(event.subrun_id);
  if (!unitId) {
    throw new Error(`[TableFillWorkflow] write trace has no batch binding for subrun ${event.subrun_id}`);
  }

  const output = readWriteToTableReplayResult(event.output)?.data;
  if (!output) {
    throw new Error(`[TableFillWorkflow] invalid write_to_table output for unit ${unitId}`);
  }

  return {
    sessionId: params.sessionId,
    unitId,
    content: output.content,
    mode: output.mode,
  };
}

/**
 * 父 batch 完成时核对业务事实：每个 completed child 必须至少成功写入一次。
 * child 业务失败允许留在 partial 结果中，但不能把“没有写表”的 child 伪装成 completed。
 */
export function assertCompletedBatchUnitsWereWritten(params: {
  event: SSEToolOutputEvent;
  expectedUnitIds: ReadonlySet<string>;
  successfulWriteCounts: ReadonlyMap<string, number>;
}): void {
  const { event } = params;
  if (event.tool_name !== SUBRUN_BATCH_TOOL_NAME) return;
  if (event.status !== 'success') {
    throw new Error('[TableFillWorkflow] subrun_batch execution failed');
  }

  const result = readSubrunBatchStructuredResult({
    data: event.data,
    observation: event.observation,
  });
  if (!result) {
    throw new Error('[TableFillWorkflow] invalid subrun_batch result');
  }

  const resultUnitIds = new Set(result.data.results.map((item) => item.unit_id));
  if (
    resultUnitIds.size !== params.expectedUnitIds.size
    || [...params.expectedUnitIds].some((unitId) => !resultUnitIds.has(unitId))
  ) {
    throw new Error('[TableFillWorkflow] subrun_batch result does not match requested units');
  }

  for (const item of result.data.results) {
    if (item.status !== 'completed') continue;
    if ((params.successfulWriteCounts.get(item.unit_id) ?? 0) < 1) {
      throw new Error(`[TableFillWorkflow] completed unit did not write to table: ${item.unit_id}`);
    }
  }
}
