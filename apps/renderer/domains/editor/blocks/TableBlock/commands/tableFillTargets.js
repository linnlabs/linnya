/**
 * tableFillTargets.js
 *
 * 把用户看到的“逻辑行列”解析为真实 ProseMirror cell 内容范围。
 *
 * 表格合并后，逻辑列/行和 rowNode.child(index) 不再一一对应：
 * - colspan 会让一个物理 cell 覆盖多个逻辑列；
 * - rowspan 会让一个物理 cell 覆盖多行。
 *
 * 所有批量填充都必须先走 TableMap，再写 tableCellContentBlock 的 inline 内容区。
 */

import { getCellContentBlockPositions } from '../utils/tableContentUtils';
import { getCellOffsetAtLogicalPosition } from '../position/tableMapUtils';

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function createTargetKey(cellOffset) {
  return String(cellOffset);
}

export function normalizeFillRows(params) {
  const { map, targetRows, skipHeader = false } = params;
  if (!map || map.height <= 0) return [];

  const rawRows = Array.isArray(targetRows)
    ? targetRows.filter((rowIndex) => isNonNegativeInteger(rowIndex) && rowIndex < map.height)
    : Array.from({ length: map.height }, (_, index) => index);

  return skipHeader
    ? rawRows.filter((rowIndex) => rowIndex !== 0)
    : rawRows;
}

export function resolveTableFillTargets(params) {
  const {
    state,
    tableNode,
    tableStartPos,
    map,
    targetColumnIndex,
    rowsToFill,
  } = params;

  if (!state || !tableNode || !map || !isNonNegativeInteger(tableStartPos)) {
    return { targets: [], skipped: [{ reason: 'invalid-table-context' }] };
  }

  if (!isNonNegativeInteger(targetColumnIndex) || targetColumnIndex >= map.width) {
    return { targets: [], skipped: [{ reason: 'column-out-of-bounds', columnIndex: targetColumnIndex }] };
  }

  const targets = [];
  const skipped = [];
  const seenCellOffsets = new Set();

  for (const rowIndex of rowsToFill) {
    if (!isNonNegativeInteger(rowIndex) || rowIndex >= map.height) {
      skipped.push({ reason: 'row-out-of-bounds', rowIndex });
      continue;
    }

    const cellOffset = getCellOffsetAtLogicalPosition(map, rowIndex, targetColumnIndex);
    if (!isNonNegativeInteger(cellOffset)) {
      skipped.push({ reason: 'missing-cell-offset', rowIndex, columnIndex: targetColumnIndex });
      continue;
    }

    const targetKey = createTargetKey(cellOffset);
    if (seenCellOffsets.has(targetKey)) {
      skipped.push({ reason: 'duplicate-spanned-cell', rowIndex, columnIndex: targetColumnIndex, cellOffset });
      continue;
    }
    seenCellOffsets.add(targetKey);

    const cellPos = tableStartPos + 1 + cellOffset;
    const cellNode = state.doc.nodeAt(cellPos);
    if (!cellNode || (cellNode.type.name !== 'tableCell' && cellNode.type.name !== 'tableHeader')) {
      skipped.push({ reason: 'missing-cell-node', rowIndex, columnIndex: targetColumnIndex, cellPos });
      continue;
    }

    const contentPositions = getCellContentBlockPositions(cellNode, cellPos);
    if (!contentPositions) {
      skipped.push({ reason: 'invalid-cell-content', rowIndex, columnIndex: targetColumnIndex, cellPos });
      continue;
    }

    targets.push({
      rowIndex,
      columnIndex: targetColumnIndex,
      cellOffset,
      cellPos,
      contentStart: contentPositions.contentStart,
      contentEnd: contentPositions.contentEnd,
      contentSize: contentPositions.contentSize,
    });
  }

  return { targets, skipped };
}

export function applyTextToTableFillTargets(params) {
  const { tr, schema, targets, content } = params;
  if (!tr || !schema || !Array.isArray(targets) || targets.length === 0) return 0;

  let appliedCount = 0;
  const text = String(content);

  for (const target of targets) {
    const mappedStart = tr.mapping.map(target.contentStart);
    const mappedEnd = tr.mapping.map(target.contentEnd);

    if (mappedEnd > mappedStart) {
      tr.delete(mappedStart, mappedEnd);
    }

    if (text.length > 0) {
      tr.insert(mappedStart, schema.text(text));
    }

    appliedCount += 1;
  }

  return appliedCount;
}
