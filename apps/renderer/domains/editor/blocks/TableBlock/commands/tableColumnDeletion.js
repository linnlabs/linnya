/**
 * tableColumnDeletion.js
 *
 * 负责“按逻辑列索引删除列”。它绕开 CellSelection 中转，直接用 TableMap +
 * removeColumn 删除指定逻辑列，避免首行 colspan 把单列删除误扩大成多列删除。
 */

import { TextSelection } from 'prosemirror-state';
import {
  removeColumn,
  TableMap,
} from 'prosemirror-tables';
import { getCellOffsetAtLogicalPosition } from '../position/tableMapUtils';
import { getCellContentBlockPositions } from '../utils/tableContentUtils';

function placeSelectionInFirstAvailableCell(tr, tablePos, preferredColumn) {
  const tableNode = tr.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== 'table') return false;

  const map = TableMap.get(tableNode);
  if (map.width === 0 || map.height === 0) return false;

  const targetColumn = Math.max(0, Math.min(preferredColumn, map.width - 1));
  const cellPosInTable = getCellOffsetAtLogicalPosition(map, 0, targetColumn);
  if (cellPosInTable === null) return false;

  const cellPos = tablePos + 1 + cellPosInTable;
  const cellNode = tr.doc.nodeAt(cellPos);
  const contentPositions = getCellContentBlockPositions(cellNode, cellPos);
  if (!contentPositions) return false;

  const textPos = contentPositions.contentStart;

  try {
    const $textPos = tr.doc.resolve(textPos);
    if ($textPos.parent.type.name === 'tableCellContentBlock') {
      tr.setSelection(TextSelection.create(tr.doc, textPos));
      return true;
    }

    tr.setSelection(TextSelection.near(tr.doc.resolve(contentPositions.start), 1));
    return true;
  } catch (error) {
    return false;
  }
}

export function deleteTableColumnAtIndex(params) {
  const { tr, tablePos, columnIndex } = params;
  const tableNode = tr.doc.nodeAt(tablePos);

  if (!tableNode || tableNode.type.name !== 'table') {
    return null;
  }

  const map = TableMap.get(tableNode);
  if (columnIndex < 0 || columnIndex >= map.width || map.width <= 1) {
    return null;
  }

  removeColumn(tr, {
    map,
    table: tableNode,
    tableStart: tablePos + 1,
  }, columnIndex);

  placeSelectionInFirstAvailableCell(
    tr,
    tablePos,
    Math.min(columnIndex, map.width - 2)
  );

  return {
    deletedColumnIndex: columnIndex,
    remainingWidth: map.width - 1,
  };
}
