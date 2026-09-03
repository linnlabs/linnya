/**
 * tableNavigationUtils.js
 * 
 * 此文件包含与表格导航相关的工具函数，用于处理表格外移动到表格内的光标移动和导航。
 * 主要功能：
 * 1. 处理向上箭头键导航
 * 2. 计算下一个单元格的位置
 * 
 * 依赖：
 * - @tiptap/pm/model 中的 Node, ResolvedPos
 * - @tiptap/pm/state 中的 EditorState
 * - @tiptap/pm/tables 中的 TableMap
 * 
 * 相关工具：
 * - 基础位置解析工具：tablePositionUtils.js
 * - TableMap 相关工具：tableMapUtils.js
 * - 选区相关工具：tableSelectionUtils.js
 * - 内容相关工具：tableContentUtils.js
 */

import { getCellOffsetAtLogicalPosition, getTableMap } from './tableMapUtils';
import { getCellContentBlockPositions } from '../utils/tableContentUtils';

/**
 * 根据物理 cell offset 解析可放置光标的目标信息。
 *
 * 中文说明：
 * - offset 来自 TableMap，基于 table 内容区；
 * - 返回的 contentStart/contentEnd 都落在 `tableCellContentBlock` 内；
 * - 键盘导航不能把光标放在 tableCell 容器边界。
 *
 * @param {import('@tiptap/pm/state').EditorState} state
 * @param {number} tablePos
 * @param {number} cellOffset
 * @returns {{
 *   cellPos: number,
 *   cellNode: import('@tiptap/pm/model').Node,
 *   contentStart: number,
 *   contentEnd: number
 * }|null}
 */
export function getCellNavigationTargetAtOffset(state, tablePos, cellOffset) {
  if (!state || !Number.isInteger(tablePos) || !Number.isInteger(cellOffset) || cellOffset < 0) {
    return null;
  }

  const cellPos = tablePos + 1 + cellOffset;
  const cellNode = state.doc.nodeAt(cellPos);
  const tableRole = cellNode?.type?.spec?.tableRole;
  if (!cellNode || (tableRole !== 'cell' && tableRole !== 'header_cell')) {
    return null;
  }

  const contentPositions = getCellContentBlockPositions(cellNode, cellPos);
  if (!contentPositions) return null;

  return {
    cellPos,
    cellNode,
    contentStart: contentPositions.contentStart,
    contentEnd: contentPositions.contentEnd,
  };
}

/**
 * 把用户看到的逻辑行列转换成真实覆盖 cell 的导航目标。
 *
 * @param {import('@tiptap/pm/state').EditorState} state
 * @param {import('@tiptap/pm/model').Node} tableNode
 * @param {number} tablePos
 * @param {number} rowIndex
 * @param {number} colIndex
 * @returns {{
 *   cellPos: number,
 *   cellNode: import('@tiptap/pm/model').Node,
 *   contentStart: number,
 *   contentEnd: number
 * }|null}
 */
export function getCellNavigationTargetAtLogicalPosition(state, tableNode, tablePos, rowIndex, colIndex) {
  const map = getTableMap(tableNode);
  if (!map) return null;

  const cellOffset = getCellOffsetAtLogicalPosition(map, rowIndex, colIndex);
  if (cellOffset === null) return null;

  return getCellNavigationTargetAtOffset(state, tablePos, cellOffset);
}

/**
 * 解析垂直相邻 cell。
 *
 * 使用 TableMap.nextCell，而不是简单的 row + 1：
 * - 当前 cell 有 rowspan 时，向下应该跳到跨度结束后的下一行；
 * - 目标行某列被上方 rowspan 覆盖时，也应该得到真实覆盖 cell。
 *
 * @param {import('@tiptap/pm/state').EditorState} state
 * @param {import('@tiptap/pm/model').Node} tableNode
 * @param {number} tablePos
 * @param {number} currentRow
 * @param {number} currentCol
 * @param {1|-1} direction
 * @returns {{
 *   cellPos: number,
 *   cellNode: import('@tiptap/pm/model').Node,
 *   contentStart: number,
 *   contentEnd: number
 * }|null}
 */
export function getAdjacentVerticalCellNavigationTarget(state, tableNode, tablePos, currentRow, currentCol, direction) {
  const map = getTableMap(tableNode);
  if (!map) return null;

  const currentCellOffset = getCellOffsetAtLogicalPosition(map, currentRow, currentCol);
  if (currentCellOffset === null) return null;

  const targetCellOffset = map.nextCell(currentCellOffset, 'vert', direction);
  if (targetCellOffset === null) return null;

  return getCellNavigationTargetAtOffset(state, tablePos, targetCellOffset);
}

/**
 * 处理向上箭头键导航到前一个表格
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {import('@tiptap/pm/model').ResolvedPos} $from - 当前位置
 * @returns {{
 *   tableNode: import('@tiptap/pm/model').Node,
 *   tableStartPos: number,
 *   finalCursorPos: number
 * }|null}
 */
export function handleArrowUpNavigation(state, $from) {
  let tableNode = null;
  let tableStartPos = -1;
  let finalCursorPos = -1;

  // 策略1：在当前 RootBlock 内查找前一个表格
  const currentContentBlockDepth = $from.depth;
  if (currentContentBlockDepth > 0) {
    const posBeforeCurrentContentBlock = $from.before(currentContentBlockDepth);
    const nodeBeforeContentBlock = state.doc.resolve(posBeforeCurrentContentBlock).nodeBefore;

    if (nodeBeforeContentBlock && nodeBeforeContentBlock.type === state.schema.nodes.table) {
      tableNode = nodeBeforeContentBlock;
      tableStartPos = posBeforeCurrentContentBlock - tableNode.nodeSize;
    }
  }

  // 策略2：在前一个 RootBlock 中查找表格
  if (!tableNode) {
    const currentRootBlockDepth = currentContentBlockDepth - 1;
    if (currentRootBlockDepth >= 0) {
      const currentRootBlockNodeStartPos = $from.before(currentRootBlockDepth);
      const prevRootBlockCandidate = state.doc.resolve(currentRootBlockNodeStartPos).nodeBefore;

      if (prevRootBlockCandidate && prevRootBlockCandidate.type === state.schema.nodes.rootBlock) {
        const tableCandidateInPrevRoot = prevRootBlockCandidate.firstChild;
        if (tableCandidateInPrevRoot && tableCandidateInPrevRoot.type === state.schema.nodes.table) {
          tableNode = tableCandidateInPrevRoot;
          const prevRootBlockActualStartPos = currentRootBlockNodeStartPos - prevRootBlockCandidate.nodeSize;
          tableStartPos = prevRootBlockActualStartPos + 1;
        }
      }
    }
  }

  if (tableNode && tableStartPos !== -1) {
    const map = getTableMap(tableNode);
    if (!map || map.height === 0) return null;

    const lastRowIndex = map.height - 1;
    const targetColIndex = 0; // 目标为最后一行的第一个单元格
    const target = getCellNavigationTargetAtLogicalPosition(
      state,
      tableNode,
      tableStartPos,
      lastRowIndex,
      targetColIndex
    );
    if (!target) return null;

    finalCursorPos = target.contentStart;
    return { tableNode, tableStartPos, finalCursorPos };
  }

  return null;
}

/**
 * 计算表格中下一个单元格的位置（保持在同一列）
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @param {number} tablePos - 表格在文档中的起始位置
 * @param {number} currentRow - 当前行索引
 * @param {number} currentCol - 当前列索引
 * @returns {number|null} 下一个单元格内容末尾的位置，如果无法计算则返回 null
 */
export function getNextCellPosition(state, tableNode, tablePos, currentRow, currentCol) {
  const target = getAdjacentVerticalCellNavigationTarget(
    state,
    tableNode,
    tablePos,
    currentRow,
    currentCol,
    1
  );
  return target ? target.contentEnd : null;
}
