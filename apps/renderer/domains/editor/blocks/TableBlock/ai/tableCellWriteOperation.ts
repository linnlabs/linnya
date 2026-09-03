import { insertOrAppendTextInCell, type TableCellWriteEditor } from './tableAiUtils.js';
import { refreshTableInfoSnapshot } from '../position/tableIdentity';

export type TableCellWriteMode = 'replace' | 'append';
export type TableCellAppendStateTracker = Record<string, boolean>;

export interface TableCellWriteTableInfo {
  pos: number;
  rootBlockId?: string | null;
}

export type TableCellWriteOperationResult =
  | { ok: true }
  | { ok: false; reason: 'table-not-found' | 'write-rejected' };

function createAppendTrackerKey(rowIndex: number, colIndex: number): string {
  return `${rowIndex}:${colIndex}`;
}

/**
 * 按稳定表格身份执行一次单元格写入。
 *
 * `pos` 只是快照；每次写入都必须先用 rootBlockId 在最新 doc 中重定位，
 * 否则表格前方的文档变化会把内容写到错误节点。
 */
export function writeTableCellByIdentity(params: {
  editor: TableCellWriteEditor;
  tableInfo: TableCellWriteTableInfo;
  rowIndex: number;
  colIndex: number;
  content: string;
  mode: TableCellWriteMode;
  appendState: TableCellAppendStateTracker;
}): TableCellWriteOperationResult {
  const freshTableInfo = refreshTableInfoSnapshot(params.editor.state.doc, params.tableInfo);
  if (!freshTableInfo) {
    return { ok: false, reason: 'table-not-found' };
  }

  const appendTrackerKey = createAppendTrackerKey(params.rowIndex, params.colIndex);
  const shouldAppend = params.mode === 'append' || params.appendState[appendTrackerKey] === true;
  const didWrite = insertOrAppendTextInCell(
    params.editor,
    freshTableInfo.node,
    freshTableInfo.pos,
    params.rowIndex,
    params.colIndex,
    params.content,
    shouldAppend,
  );
  if (!didWrite) {
    return { ok: false, reason: 'write-rejected' };
  }

  // 只有真实 dispatch 成功后才能推进追加状态，失败重试仍应保持首次写语义。
  params.appendState[appendTrackerKey] = true;
  return { ok: true };
}
