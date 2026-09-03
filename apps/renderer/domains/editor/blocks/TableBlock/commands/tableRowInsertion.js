/**
 * tableRowInsertion.js
 *
 * 适配 ProseMirror tables 的行插入算法，同时保证新 cell 使用 Linnya 的
 * tableCellContentBlock 内容模型。
 */

import {
  rowIsHeader,
  tableNodeTypes,
} from 'prosemirror-tables';
import { generateBlockId } from '../../../../../shared/utils/idUtils';

const DEFAULT_COLUMN_WIDTH = 150;

function createCellContentBlock(schema, createId) {
  return schema.nodes.tableCellContentBlock.create({
    id: createId(),
    blockType: 'tableCellContent',
  });
}

function getColumnWidthForReferenceCell(map, cellPosInTable, referenceCell, col) {
  const colwidth = referenceCell?.attrs?.colwidth;
  if (!Array.isArray(colwidth) || colwidth.length === 0) {
    return DEFAULT_COLUMN_WIDTH;
  }

  const cellStartColumn = map.colCount(cellPosInTable);
  const width = colwidth[col - cellStartColumn];
  return typeof width === 'number' && width > 0 ? width : DEFAULT_COLUMN_WIDTH;
}

function createInsertedCell(params) {
  const {
    schema,
    cellType,
    colwidth,
    createId,
  } = params;
  const cellContent = createCellContentBlock(schema, createId);
  return cellType.create(
    { colwidth: [colwidth] },
    cellContent
  );
}

export function insertTableRowAt(params) {
  const {
    tr,
    rect,
    row,
    createId = generateBlockId,
  } = params;

  const { map, tableStart, table } = rect;
  const schema = table.type.schema;
  const tableTypes = tableNodeTypes(schema);
  let rowPos = tableStart;
  let refRow = row > 0 ? -1 : 0;
  const cells = [];
  let expandedCellCount = 0;

  if (!schema.nodes.tableCellContentBlock) return null;

  for (let rowIndex = 0; rowIndex < row; rowIndex++) {
    rowPos += table.child(rowIndex).nodeSize;
  }

  if (rowIsHeader(map, table, row + refRow)) {
    refRow = row === 0 || row === map.height ? null : 0;
  }

  for (let col = 0, index = map.width * row; col < map.width; col += 1, index += 1) {
    if (row > 0 && row < map.height && map.map[index] === map.map[index - map.width]) {
      const cellPosInTable = map.map[index];
      const cellNode = table.nodeAt(cellPosInTable);
      tr.setNodeMarkup(
        tr.mapping.map(tableStart + cellPosInTable),
        null,
        {
          ...cellNode.attrs,
          rowspan: cellNode.attrs.rowspan + 1,
        }
      );
      expandedCellCount += 1;
      col += cellNode.attrs.colspan - 1;
      index += cellNode.attrs.colspan - 1;
      continue;
    }

    const referenceCellPos = refRow === null ? null : map.map[index + refRow * map.width];
    const referenceCell = referenceCellPos === null ? null : table.nodeAt(referenceCellPos);
    const cellType = referenceCell ? referenceCell.type : tableTypes.cell;
    const colwidth = referenceCellPos === null
      ? DEFAULT_COLUMN_WIDTH
      : getColumnWidthForReferenceCell(map, referenceCellPos, referenceCell, col);
    const newCell = createInsertedCell({
      schema,
      cellType,
      colwidth,
      createId,
    });
    cells.push(newCell);
  }

  const rowNode = tableTypes.row.create(null, cells);
  if (!rowNode) return null;

  const mappedRowPos = tr.mapping.map(rowPos);
  tr.insert(mappedRowPos, rowNode);

  return {
    firstInsertedContentPos: cells.length > 0 ? mappedRowPos + 3 : -1,
    insertedCellCount: cells.length,
    expandedCellCount,
  };
}
