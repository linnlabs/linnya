//src/renderer/features/TableBlock/tableKeys.js

import { TextSelection } from 'prosemirror-state';
import { selectedRect } from '@tiptap/pm/tables';
import {
  isInTableCellByResolvedPos,
  findCellAndTableInfoFromResolvedPos,
  getResolvedSelection,
} from './position/tableSelectionUtils';
import {
  getTableMap,
} from './position/tableMapUtils';
import {
  getAdjacentVerticalCellNavigationTarget,
  getCellNavigationTargetAtLogicalPosition,
  getNextCellPosition,
} from './position/tableNavigationUtils';
import {
  getCellContentBlockPositions,
  getNewRowFirstCellPositions,
  getNewRowInsertPosition,
} from './utils/tableContentUtils';
import {
  tableVerticalNavStateKey
} from './extensions/TableVerticalNavigationState';
import {
  getCellBoundingRect
} from './position/tablePositionUtils';
import { positionInCellAtCoords } from './position/tableNodeAtCoords';

/**
 * 处理 Enter 键在表格内的行为。
 * 目标：
 * 1. 在非最后一行单元格内按 Enter，光标移动到当前列下一行单元格内容的【末尾】。
 * 2. 在最后一行单元格内按 Enter，退出表格。
 *    - 如果表格后有其他块，光标聚焦到下一个块内容的【开头】。
 *    - 如果没有，则创建新的 baseBlock 并聚焦到其内容的【开头】。
 */
export function handleEnterKey({ editor }) {
  const { state, dispatch } = editor.view;
  const { $head } = getResolvedSelection(state);

  if (!isInTableCellByResolvedPos($head)) {
    return false;
  }

  const tableInfo = findCellAndTableInfoFromResolvedPos($head, editor.schema.nodes.table);
  if (!tableInfo) {
    return false;
  }

  const { tableNode, tablePos } = tableInfo;
  const map = getTableMap(tableNode);
  if (!map) {
    return false;
  }

  const currentSelectionRect = selectedRect(state);
  if (!currentSelectionRect || typeof currentSelectionRect.top === 'undefined') { 
    return false; 
  }

  const currentRow = currentSelectionRect.top;
  const currentCol = currentSelectionRect.left;

  // 非末端单元格：移动到垂直相邻的下一个真实 cell。
  // 注意：rowspan 会让“当前行 + 1”仍处在同一个 cell 覆盖范围内，
  // 因此这里以 TableMap.nextCell 的真实垂直邻居为准。
  const targetPos = getNextCellPosition(state, tableNode, tablePos, currentRow, currentCol);
  if (targetPos !== null) {
    try {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, targetPos)).scrollIntoView());
    } catch (e) {
      console.error(`[TableBlockKeys/handleEnterKey] Error setting selection to pos ${targetPos} in next cell:`, e);
      return false;
    }
    return true;
  }

  // 没有垂直下一个真实 cell：退出表格。
  // 这不仅覆盖普通最后一行，也覆盖当前 cell 通过 rowspan 一直跨到表格底部的情况。
  // 我们不再手动检查下一个块或手动插入新块，因为这在处理原子块等边缘情况时很复杂且容易出错。
  // 相反，我们委托给一个健壮的、集中的命令 `createRootBlock` 来处理。
  // 这个命令负责在指定位置之后创建新的根块，并正确地将光标放入其中。
  // 这样可以确保行为一致，并与编辑器的核心逻辑解耦。

  // 使用 'createRootBlock' 命令在当前表格的根块之后创建一个新的根块。
  // 这是处理所有情况（包括后面有原子块或没有块）的最干净、最可靠的方法。
  if (!editor.commands.createRootBlock({
    position: 'after',
    referencePos: $head.pos, // 使用当前光标位置作为参考点
  })) {
    console.error('[TableBlockKeys/handleEnterKey] Failed to create a new block after the table.');
    return false;
  }

  return true;
}

/**
 * 处理 Tab 键在表格内的行为。
 * 目标：
 * 1. 在非当前行最后一个单元格内按 Tab，光标移动到当前行下一个单元格内容的【末尾】。
 * 2. 在当前行最后一个单元格内按 Tab，应在表格末尾添加一个新行，并将光标移动到新行第一个单元格内容的【末尾】。
 */
export function handleTabKey({ editor }) {
  const { state, dispatch } = editor.view;
  let current$head = getResolvedSelection(state).$head; 

  if (!isInTableCellByResolvedPos(current$head)) {
    return false;
  }

  if (editor.commands.goToNextCell()) {
    const newState = editor.view.state;
    current$head = getResolvedSelection(newState).$head;

    if (!isInTableCellByResolvedPos(current$head)) {
      return false;
    }

    const tableInfo = findCellAndTableInfoFromResolvedPos(current$head, editor.schema.nodes.table);
    if (!tableInfo) {
      return false;
    }

    const { cellNode, cellPos } = tableInfo;
    const contentPositions = getCellContentBlockPositions(cellNode, cellPos);
    if (!contentPositions) return false;

    const targetPos = contentPositions.contentEnd;

    try {
      dispatch(newState.tr.setSelection(TextSelection.create(newState.doc, targetPos)).scrollIntoView());
      return true;
    } catch (e) {
      console.error(`[TableBlockKeys/handleTabKey] Error setting selection to pos ${targetPos} in next cell after goToNextCell:`, e);
      return false;
    }
  } else {
    const originalTableInfo = findCellAndTableInfoFromResolvedPos(current$head, editor.schema.nodes.table);
    if (!originalTableInfo) {
      return false;
    }

    const { tableNode, tablePos } = originalTableInfo;
    const map = getTableMap(tableNode);
    if (!map) {
      return false;
    }

    const newRowAbsoluteInsertionPos = getNewRowInsertPosition(tableNode, tablePos);
    const cells = [];

    for (let i = 0; i < map.width; i++) {
      let cellContent = null;
      if (editor.schema.nodes.tableCellContentBlock) {
        cellContent = editor.schema.nodes.tableCellContentBlock.createAndFill();
      } else if (editor.schema.nodes.baseBlock) {
        cellContent = editor.schema.nodes.baseBlock.createAndFill();
      } else if (editor.schema.nodes.paragraph) {
          cellContent = editor.schema.nodes.paragraph.createAndFill();
      }
      
      const newCell = editor.schema.nodes.tableCell?.create(null, cellContent);
      if (newCell) cells.push(newCell);
    }

    if (cells.length !== map.width || cells.length === 0) { 
      return false;
    }

    const newRowNode = editor.schema.nodes.tableRow?.create(null, cells);
    if (!newRowNode) {
      return false;
    }

    const tr = state.tr.insert(newRowAbsoluteInsertionPos, newRowNode);
    const newTableNodeInTr = tr.doc.nodeAt(tablePos);
    if (!newTableNodeInTr || newTableNodeInTr.type.name !== editor.schema.nodes.table.name) {
      return false;
    }

    const focusPositions = getNewRowFirstCellPositions(tr, newTableNodeInTr, tablePos, map.height);
    if (!focusPositions || focusPositions.contentStartPos === null) {
      return false;
    }

    tr.setSelection(TextSelection.create(tr.doc, focusPositions.contentStartPos)).scrollIntoView();
    dispatch(tr);

    return true; 
  }
}

/**
 * 处理 Shift+Tab 键在表格内的行为。
 * 目标：
 * 1. 在非当前行第一个单元格内按 Shift+Tab，光标移动到当前行上一个单元格内容的【末尾】。
 * 2. 在当前行第一个单元格内按 Shift+Tab，应无操作（或可自定义为跳出表格）。
 */
export function handleShiftTabKey({ editor }) {
  const { state, dispatch } = editor.view;
  let current$head = getResolvedSelection(state).$head;

  if (!isInTableCellByResolvedPos(current$head)) {
    return false;
  }

  // 获取当前单元格的行列信息
  const tableInfo = findCellAndTableInfoFromResolvedPos(current$head, editor.schema.nodes.table);
  if (!tableInfo) {
    return false;
  }
  const { tableNode, tablePos } = tableInfo;
  const map = getTableMap(tableNode);
  if (!map) {
    return false;
  }
  const currentSelectionRect = selectedRect(state);
  if (!currentSelectionRect || typeof currentSelectionRect.left === 'undefined') {
    return false;
  }
  const currentRow = currentSelectionRect.top;
  const currentCol = currentSelectionRect.left;

  // 如果已经是当前行第一个单元格，暂不处理（可自定义为跳出表格）
  if (currentCol === 0) {
    return false;
  }

  // 上一个“逻辑格子”可能被 rowspan / colspan 的物理 cell 覆盖，不能直接用 positionAt。
  const target = getCellNavigationTargetAtLogicalPosition(
    state,
    tableNode,
    tablePos,
    currentRow,
    currentCol - 1
  );
  if (!target) return false;
  const targetPos = target.contentEnd;

  try {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, targetPos)).scrollIntoView());
    return true;
  } catch (e) {
    console.error(`[TableBlockKeys/handleShiftTabKey] Error setting selection to pos ${targetPos} in previous cell:`, e);
    return false;
  }
}

/**
 * 处理 ArrowUp 和 ArrowDown 键在表格内的垂直导航
 * @param {{ editor: import('@tiptap/core').Editor, event: KeyboardEvent, direction: 1 | -1 }}
 * @returns {boolean} 是否成功处理
 */
export function handleArrowVertical({
  editor,
  event,
  direction
}) {
  const {
    view
  } = editor;
  const {
    state,
    dispatch
  } = view;
  const {
    doc,
    selection,
    schema
  } = state;

  if (!isInTableCellByResolvedPos(selection.$from)) {
    return false;
  }

  // --- Start: Edge detection for multi-line cells ---
  // This logic checks if the cursor is at the very top or bottom edge of a cell.
  // If not, it returns false, allowing ProseMirror's default vertical navigation
  // to handle movement within the multi-line content of a single cell.
  try {
    const tableInfoForEdgeCheck = findCellAndTableInfoFromResolvedPos(selection.$from, schema.nodes.table);
    // This check is crucial to ensure we are in a cell and can get its info.
    if (!tableInfoForEdgeCheck) return false;

    const {
      cellNode,
      cellPos
    } = tableInfoForEdgeCheck;
    const contentPositions = getCellContentBlockPositions(cellNode, cellPos);
    // This provides the start and end positions of the editable content within the cell.
    if (!contentPositions) return false;

    // We need the on-screen coordinates to determine the visual position of the cursor.
    const cursorCoords = view.coordsAtPos(selection.from);

    if (direction === -1) { // ArrowUp
      const cellTopCoords = view.coordsAtPos(contentPositions.contentStart);
      // If the cursor's top is not within a small tolerance of the cell's content top,
      // it means we are not at the top edge.
      if (Math.abs(cursorCoords.top - cellTopCoords.top) > 5) {
        return false;
      }
    } else { // ArrowDown
      const cellBottomCoords = view.coordsAtPos(contentPositions.contentEnd);
      // Similarly, if the cursor's bottom is not close to the cell's content bottom,
      // we are not at the bottom edge.
      if (Math.abs(cursorCoords.bottom - cellBottomCoords.bottom) > 5) {
        return false;
      }
    }
  } catch (e) {
    // view.coordsAtPos can throw an error if the position is not in a visible part of the DOM.
    // In such cases, we abort our custom logic to prevent unexpected behavior.
    console.warn('[handleArrowVertical] Coordinate-based edge check failed, aborting custom navigation.', e);
    return false;
  }
  // --- End: Edge detection for multi-line cells ---

  // If the code reaches here, it means the cursor is at the top/bottom edge of the cell,
  // so we proceed with the original logic for navigating between cells.
  const verticalNavState = tableVerticalNavStateKey.getState(state);
  let lastGoodX = verticalNavState?.lastGoodX;

  // 如果插件状态中没有 lastGoodX（例如首次移动），则立即计算
  if (lastGoodX === null || lastGoodX === undefined) {
    try {
      lastGoodX = view.coordsAtPos(selection.from).left;
    } catch (e) {
      console.warn('[handleArrowVertical] Could not calculate initial coords. Aborting.');
      return false; // 如果无法获取坐标，则不处理
    }
  }

  const tableInfo = findCellAndTableInfoFromResolvedPos(selection.$from, schema.nodes.table);
  if (!tableInfo) return false;

  const {
    tableNode,
    tablePos
  } = tableInfo;
  const map = getTableMap(tableNode);
  const rect = selectedRect(state);
  if (!map || !rect) return false;

  const {
    top: currentRow,
    left: currentCol
  } = rect;

  const targetRow = currentRow + direction;
  if (targetRow < 0 || targetRow >= map.height) {
    return false;
  }


  try {
    const target = getAdjacentVerticalCellNavigationTarget(
      state,
      tableNode,
      tablePos,
      currentRow,
      currentCol,
      direction
    );
    if (!target) return false;
    const { cellPos: targetCellPos } = target;

    const cellRect = getCellBoundingRect(editor, targetCellPos);
    if (!cellRect) {
      console.warn('[handleArrowVertical] Could not get target cell bounding rect.');
      return false;
    }

    // Bias probe points towards the entry edge for better line entry:
    // For down (direction=1): bias towards top to prefer first line.
    // For up (direction=-1): bias towards bottom to prefer last line.
    // Uses three points weighted towards the edge for robustness.
    const halfHeight = cellRect.height / 2;
    const probePointsY = direction === 1
      ? [
          cellRect.top + 5,               // Near top
          cellRect.top + halfHeight / 2,  // Quarter height
          cellRect.top + halfHeight       // Mid (fallback)
        ]
      : [
          cellRect.bottom - 5,               // Near bottom
          cellRect.bottom - halfHeight / 2,  // Three-quarter height
          cellRect.bottom - halfHeight       // Mid (fallback)
        ];

    let idealPos = null;

    for (const y of probePointsY) {
      const posAtCoords = view.posAtCoords({
        left: lastGoodX,
        top: y
      });

      if (posAtCoords) {
        if (posAtCoords.pos >= target.contentStart && posAtCoords.pos <= target.contentEnd) {
          idealPos = posAtCoords.pos;
          break; // Found a valid position, stop probing
        }
      }
    }

    if (idealPos === null) {
      
      const targetY = direction === 1 ? cellRect.top + 5 : cellRect.bottom - 5;
      
      idealPos = positionInCellAtCoords(
        view,
        targetCellPos,
        lastGoodX,
        targetY
      );

      // Ultimate fallback if even the custom function fails.
      if (idealPos === null) {
        idealPos = direction === 1 
          ? target.contentStart
          : target.contentEnd;
      }
    }

    const tr = state.tr
      .setSelection(TextSelection.create(doc, idealPos))
      .scrollIntoView();

    tr.setMeta('isVerticalNav', true);
    dispatch(tr);
    event.preventDefault();
    return true;

  } catch (e) {
    console.error('[handleArrowVertical] Error during vertical navigation:', e);
    return false;
  }
}
