/**
 * tableColumnInsertion.js
 *
 * 适配 ProseMirror tables 的列插入算法，同时保证 Linnya 单元格内部使用
 * tableCellContentBlock，并为新内容块生成稳定 id。
 */

import {
  addColSpan,
  columnIsHeader,
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

function createInsertedCell(schema, cellType, createId, defaultColumnWidth) {
  const cellContent = createCellContentBlock(schema, createId);
  return cellType.create(
    { colwidth: [defaultColumnWidth] },
    cellContent
  );
}

export function insertTableColumnAt(params) {
  const {
    tr,
    rect,
    col,
    createId = generateBlockId,
    defaultColumnWidth = DEFAULT_COLUMN_WIDTH,
  } = params;

  const { map, tableStart, table } = rect;
  const schema = table.type.schema;
  const tableTypes = tableNodeTypes(schema);
  let refColumn = col > 0 ? -1 : 0;
  let firstInsertedContentPos = -1;
  let insertedCellCount = 0;
  let expandedCellCount = 0;

  if (!schema.nodes.tableCellContentBlock) return null;

  if (columnIsHeader(map, table, col + refColumn)) {
    refColumn = col === 0 || col === map.width ? null : 0;
  }

  for (let row = 0; row < map.height; row++) {
    const index = row * map.width + col;

    if (col > 0 && col < map.width && map.map[index - 1] === map.map[index]) {
      const cellPosInTable = map.map[index];
      const cellNode = table.nodeAt(cellPosInTable);
      const colspanOffset = col - map.colCount(cellPosInTable);
      tr.setNodeMarkup(
        tr.mapping.map(tableStart + cellPosInTable),
        null,
        addColSpan(cellNode.attrs, colspanOffset)
      );
      expandedCellCount += 1;
      row += cellNode.attrs.rowspan - 1;
      continue;
    }

    const referenceCell = refColumn === null ? null : table.nodeAt(map.map[index + refColumn]);
    const cellType = referenceCell ? referenceCell.type : tableTypes.cell;
    const newCell = createInsertedCell(schema, cellType, createId, defaultColumnWidth);
    const insertPosInTable = map.positionAt(row, col, table);
    const mappedInsertPos = tr.mapping.map(tableStart + insertPosInTable);

    tr.insert(mappedInsertPos, newCell);
    insertedCellCount += 1;

    if (firstInsertedContentPos === -1) {
      firstInsertedContentPos = mappedInsertPos + 2;
    }
  }

  return {
    firstInsertedContentPos,
    insertedCellCount,
    expandedCellCount,
  };
}
