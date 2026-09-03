/**
 * tableMapUtils.js
 * 
 * 此文件包含与 TableMap 相关的工具函数，用于处理表格的行列计算和位置查找。
 * 主要功能：
 * 1. 获取表格的 TableMap 实例
 * 2. 从 TableMap 中安全地检索单元格信息
 * 
 * 依赖：
 * - @tiptap/pm/tables 中的 TableMap
 * 
 * 相关工具：
 * - 基础位置解析工具：tablePositionUtils.js
 * - 选区相关工具：tableSelectionUtils.js
 * - 内容相关工具：tableContentUtils.js
 * - 导航相关工具：tableNavigationUtils.js
 */

import { TableMap } from '@tiptap/pm/tables';

/**
 * 获取表格的 TableMap 实例
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @returns {import('@tiptap/pm/tables').TableMap|null}
 */
export function getTableMap(tableNode) {
  if (!tableNode || tableNode.type.name !== 'table') return null;
  return TableMap.get(tableNode);
}

/**
 * 获取某个逻辑行列坐标对应的物理 cell offset。
 *
 * 说明：
 * - `map.positionAt(row, col, tableNode)` 更适合“插入位置”推导；
 * - `map.map[row * width + col]` 才表示这个逻辑格子当前被哪个物理 cell 覆盖；
 * - 在 rowspan / colspan 场景中，读取或写入已有 cell 必须使用本函数。
 *
 * @param {import('@tiptap/pm/tables').TableMap} map
 * @param {number} rowIndex
 * @param {number} colIndex
 * @returns {number|null}
 */
export function getCellOffsetAtLogicalPosition(map, rowIndex, colIndex) {
  if (
    !map ||
    !Number.isInteger(rowIndex) ||
    !Number.isInteger(colIndex) ||
    rowIndex < 0 ||
    colIndex < 0 ||
    rowIndex >= map.height ||
    colIndex >= map.width
  ) {
    return null;
  }

  const cellOffset = map.map[rowIndex * map.width + colIndex];
  return Number.isInteger(cellOffset) && cellOffset >= 0 ? cellOffset : null;
}

/**
 * 从 TableMap 中安全地检索单元格信息 (如原始行、列、相对于表内容的偏移)
 * @param {import('@tiptap/pm/tables').TableMap} map - TableMap 实例
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @param {number} offsetFromTableContentStart - 目标位置相对于表格**内容区**起始点 (`tableStartPos + 1`) 的偏移量。
 *                                              通常计算方式为: `cellNodeDocPos - (tableStartPos + 1)`，其中 `cellNodeDocPos` 是单元格节点的绝对起始位置，
 *                                              `tableStartPos` 是表格节点的绝对起始位置。
 *                                              如果提供的是单元格内部的某个位置的偏移，`map.findCell` 也能处理。
 * @returns {({row: number, col: number, pos: number, top: number, left: number, bottom: number, right: number})|null} 返回包含行列、偏移及单元格矩形信息的对象，或 null
 */
export function getCellInfoFromTableMap(map, tableNode, offsetFromTableContentStart) {
  if (!map || !tableNode) return null;
  try {
    // map.findCell 返回的是 {left, top, right, bottom} 代表单元格在map中的坐标系
    // 它本身并不直接返回 Prosemirror Node 的 pos 或 row/col 索引，这些需要从 TableMap 结构中推断
    // 修正：map.findCell 返回的确实是基于0的行列索引 left, top, right, bottom
    // 但是，原始的 getCellInfoFromTableMap 只取了 row, col, pos. 我们应该返回完整的 rect
    const cellRect = map.findCell(offsetFromTableContentStart);
    if (!cellRect || typeof cellRect.top !== 'number' || typeof cellRect.left !== 'number') {
      return null;
    }
    // The 'pos' field in the object returned by map.findCell is the offset of the cell's content
    // from the start of the table node. This is NOT the cell's node position itself.
    // The `map.map` array contains the offset of the cell from the start of the table node (position of <table> tag)
    // For consistency and to provide the cell's node start relative to table content, let's find it.
    // map.map[row * map.width + col] is the offset from table start.
    // The rect object itself (left,top,right,bottom) is what we usually need for geometry.
    
    // map.findCell(pos) 返回的对象包含:
    // left, right: 0-indexed column numbers for the cell.
    // top, bottom: 0-indexed row numbers for the cell.
    // pos: The offset of the cell from the start of the table node. (This seems to be what prosemirror-tables states for its internal CellMap.findCell, which TableMap uses)
    // Let's re-verify what Prosemirror's TableMap.findCell returns for 'pos'.
    // According to prosemirror-tables source (CellMap.prototype.findCell), `pos` is NOT returned by findCell.
    // findCell returns an object {left, top, right, bottom}.
    // The `pos` we were returning before seems to be a misunderstanding or custom addition not from core PM.
    // If we need the cell's starting position *within the table's content*, that's map.map[cellRect.top * map.width + cellRect.left]

    const cellOffsetInTableContent = map.map[cellRect.top * map.width + cellRect.left];
    if (typeof cellOffsetInTableContent === 'undefined') {
        // This could happen if the offsetFromTableContentStart was inside a cell that's
        // part of a merged region but not its top-left master cell.
        // map.findCell correctly finds the encompassing rect, but direct map.map lookup might fail for non-top-left parts.
        // However, cellRect.top and cellRect.left *should* always point to a valid master cell in map.map.
        console.warn('[tableMapUtils] Could not find cellOffsetInTableContent from map.map using rect from findCell. This might indicate an issue if the table has complex spans and the initial offset was not in the top-left of a merged cell.');
        // Fallback or decide what 'pos' means. For now, let's assume it's the offset of the top-left part of the cell.
    }


    return {
      // row and col are 0-indexed, referring to the top-left corner of the (potentially merged) cell
      row: cellRect.top, 
      col: cellRect.left,
      // pos: The offset of the (top-left) cell node from the start of the table's content.
      // Example: if table is at 5, table content starts at 6. If cell is at 7, this pos should be 1.
      posInTableContent: cellOffsetInTableContent, 
      ...cellRect // includes left, top, right, bottom
    };
  } catch (e) {
    console.error('[tableMapUtils] Error in getCellInfoFromTableMap:', e, { offsetFromTableContentStart });
    return null;
  }
}

/**
 * 根据单元格节点的文档绝对起始位置，获取其在 TableMap 中的矩形信息。
 * 这是对 map.findCell 的封装，处理了从文档位置到 TableMap 所需偏移量的转换。
 *
 * @param {import('@tiptap/pm/tables').TableMap} map - TableMap 实例。
 * @param {number} cellNodeDocPos - 目标单元格节点 (`<td>` 或 `<th>`) 在整个文档中的绝对起始位置。
 * @param {number} tableStartPos - 该表格节点 (`<table>`) 在整个文档中的绝对起始位置。
 * @returns {({left: number, top: number, right: number, bottom: number})|null} 单元格的矩形信息 (包含 left, top, right, bottom 列/行索引)，如果找不到则返回 null。
 */
export function getCellRectFromCellNodePos(map, cellNodeDocPos, tableStartPos) {
  if (!map || typeof cellNodeDocPos !== 'number' || typeof tableStartPos !== 'number') {
    console.warn('[tableMapUtils] getCellRectFromCellNodePos: Invalid arguments.', { map, cellNodeDocPos, tableStartPos });
    return null;
  }

  // TableMap.findCell expects the offset relative to the start of the table's *content*.
  // Table node starts at tableStartPos. Its content starts at tableStartPos + 1.
  const offsetFromTableContentStart = cellNodeDocPos - (tableStartPos + 1);

  if (offsetFromTableContentStart < 0) {
    console.warn('[tableMapUtils] getCellRectFromCellNodePos: Calculated offset is negative. cellNodeDocPos might be outside or before table content.', { cellNodeDocPos, tableStartPos, offsetFromTableContentStart });
    return null;
  }
  
  try {
    const cellRect = map.findCell(offsetFromTableContentStart);
    // findCell returns an object like {left, top, right, bottom}
    // These are 0-indexed col/row numbers.
    if (!cellRect || typeof cellRect.top !== 'number' || typeof cellRect.left !== 'number') {
      return null;
    }
    return cellRect;
  } catch (e) {
    console.error('[tableMapUtils] Error in getCellRectFromCellNodePos:', e, { cellNodeDocPos, tableStartPos, offsetFromTableContentStart });
    return null;
  }
}
