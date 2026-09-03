import { CellSelection, selectedRect } from '@tiptap/pm/tables';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Selection } from '@tiptap/pm/state';
import type { ColumnRef, OutputRect, TableInfo, TableRect, TargetColumn } from './types/tableAiTypes';
import {
  findTableIdentityAtPosition,
  refreshTableInfoSnapshot,
} from '../../position/tableIdentity';

type UnknownRecord = Record<string, unknown>;

export type TableAiContextSource = 'current-selection' | 'saved-context';

export type TableAiContextFailureReason =
  | 'selection-required'
  | 'selection-rect-missing'
  | 'selection-table-missing'
  | 'saved-context-missing'
  | 'saved-table-missing'
  | 'saved-rect-invalid';

export interface ResolvedTableAiSelectionContext {
  source: TableAiContextSource;
  rect: TableRect;
  tableNode: ProseMirrorNode;
  tableInfo: TableInfo;
  selection: CellSelection | null;
}

export interface ResolveTableAiSelectionContextParams {
  state: EditorState;
  selection: Selection;
  savedTableInfo: TableInfo | null;
  savedRect: TableRect | null;
}

export type ResolveTableAiSelectionContextResult =
  | {
      ok: true;
      context: ResolvedTableAiSelectionContext;
    }
  | {
      ok: false;
      reason: TableAiContextFailureReason;
    };

export interface OutputColumnConfig extends OutputRect {
  needsNewColumn: boolean;
}

export interface CorrectedColumnInsertionRects {
  insertedAtColumn: number;
  correctedRect: TableRect;
  correctedOutputRect: OutputColumnConfig;
}

interface ExtractedColumnReference {
  name: string;
  reference: string;
  range: string;
  rect: TableRect;
}

interface ExtractedColumnReferenceContext {
  columnRefs: ExtractedColumnReference[];
  selectionRange: string;
  targetColumn: TargetColumn;
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isTableRect(value: unknown): value is TableRect {
  if (!isRecord(value)) return false;
  return (
    typeof value.top === 'number' &&
    typeof value.bottom === 'number' &&
    typeof value.left === 'number' &&
    typeof value.right === 'number' &&
    value.top >= 0 &&
    value.bottom > value.top &&
    value.left >= 0 &&
    value.right > value.left
  );
}

/**
 * 把 PM table 工具返回的矩形拍平成 TableBlock 自己的 DTO。
 *
 * selectedRect(state) 会额外携带 map/table/tableStart 等内部字段。
 * 这些字段不能流入 UI / store 状态，否则虚拟化重建、日志和上下文持久化会被 PM 内部结构污染。
 */
function toPlainTableRect(rect: TableRect): TableRect {
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

function isTargetColumn(value: unknown): value is TargetColumn {
  if (!isRecord(value)) return false;
  return typeof value.index === 'number' && typeof value.exists === 'boolean';
}

function isExtractedColumnReference(value: unknown): value is ExtractedColumnReference {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.reference === 'string' &&
    typeof value.range === 'string' &&
    isTableRect(value.rect)
  );
}

export function isExtractedColumnReferenceContext(value: unknown): value is ExtractedColumnReferenceContext {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.columnRefs) &&
    value.columnRefs.every(isExtractedColumnReference) &&
    typeof value.selectionRange === 'string' &&
    isTargetColumn(value.targetColumn)
  );
}

export function createOutputColumnConfig(
  rect: TableRect,
  tableNode: ProseMirrorNode,
): OutputColumnConfig {
  const tableWidth = tableNode.firstChild?.childCount ?? 0;
  return {
    left: rect.right,
    right: rect.right + 1,
    top: rect.top,
    bottom: rect.bottom,
    isOutputColumn: true,
    needsNewColumn: rect.right >= tableWidth,
  };
}

function resolveCurrentCellSelectionContext(
  state: EditorState,
  selection: CellSelection
): ResolveTableAiSelectionContextResult {
  const rect = selectedRect(state);
  if (!isTableRect(rect)) {
    return { ok: false, reason: 'selection-rect-missing' };
  }
  const plainRect = toPlainTableRect(rect);

  const tableNode = selection.$anchorCell.node(-1);
  const tablePos = selection.$anchorCell.start(-1) - 1;
  const tableIdentity = findTableIdentityAtPosition(state.doc, tablePos);

  if (!tableNode || !tableIdentity) {
    return { ok: false, reason: 'selection-table-missing' };
  }

  return {
    ok: true,
    context: {
      source: 'current-selection',
      rect: plainRect,
      tableNode: tableIdentity.node,
      tableInfo: {
        node: tableIdentity.node,
        pos: tableIdentity.pos,
        rootBlockId: tableIdentity.rootBlockId,
        anchorPos: selection.$anchorCell.pos,
        headPos: selection.$headCell.pos,
      },
      selection,
    },
  };
}

function resolveSavedTableContext(
  state: EditorState,
  savedTableInfo: TableInfo | null,
  savedRect: TableRect | null
): ResolveTableAiSelectionContextResult {
  if (!savedTableInfo || typeof savedTableInfo.pos !== 'number') {
    return { ok: false, reason: 'saved-context-missing' };
  }

  if (!isTableRect(savedRect)) {
    return { ok: false, reason: 'saved-rect-invalid' };
  }
  const plainRect = toPlainTableRect(savedRect);

  const refreshedTableInfo = refreshTableInfoSnapshot(state.doc, savedTableInfo);
  if (!refreshedTableInfo) {
    return { ok: false, reason: 'saved-table-missing' };
  }

  return {
    ok: true,
    context: {
      source: 'saved-context',
      rect: plainRect,
      tableNode: refreshedTableInfo.node,
      tableInfo: refreshedTableInfo,
      selection: null,
    },
  };
}

export function resolveTableAiSelectionContext(
  params: ResolveTableAiSelectionContextParams
): ResolveTableAiSelectionContextResult {
  const { state, selection, savedTableInfo, savedRect } = params;

  if (selection instanceof CellSelection) {
    return resolveCurrentCellSelectionContext(state, selection);
  }

  return resolveSavedTableContext(state, savedTableInfo, savedRect);
}

export function mapExtractedColumnRefsToColumnRefs(
  extracted: ExtractedColumnReference[]
): ColumnRef[] {
  return extracted.map((col) => ({
    name: col.name,
    reference: col.reference,
    range: col.range,
    rect: toPlainTableRect(col.rect),
  }));
}

export function adjustTableRectForColumnInsertion<T extends TableRect>(
  rect: T,
  insertedAtColumn: number
): T {
  if (rect.left >= insertedAtColumn) {
    return {
      ...rect,
      left: rect.left + 1,
      right: rect.right + 1,
    };
  }

  if (rect.left < insertedAtColumn && rect.right > insertedAtColumn) {
    return {
      ...rect,
      right: rect.right + 1,
    };
  }

  return { ...rect };
}

export function correctRectsAfterOutputColumnInsertion(params: {
  rect: TableRect;
  outputRect: OutputColumnConfig;
}): CorrectedColumnInsertionRects {
  const insertedAtColumn = params.rect.right;

  return {
    insertedAtColumn,
    correctedRect: adjustTableRectForColumnInsertion(params.rect, insertedAtColumn),
    correctedOutputRect: {
      ...adjustTableRectForColumnInsertion(params.outputRect, insertedAtColumn),
      needsNewColumn: false,
    },
  };
}
