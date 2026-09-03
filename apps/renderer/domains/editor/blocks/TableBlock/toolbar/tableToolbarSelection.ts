import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { getCellOffsetAtLogicalPosition } from '../position/tableMapUtils';

export type TableToolbarEditor = Editor;

export type TableToolbarCommand = (editor: TableToolbarEditor) => boolean | void;

export function findCurrentCellPos(state: EditorState): number | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const nodeAtDepth = $from.node(depth);
    if (nodeAtDepth.type.name === 'tableCell' || nodeAtDepth.type.name === 'tableHeader') {
      return $from.before(depth);
    }
  }
  return null;
}

/**
 * 将普通文本选区提升为 CellSelection。
 *
 * 中文说明：表格 toolbar 命令都以“单元格选择”为入口；如果用户光标仍在单元格文本里，
 * 这里只做一次合法提升，不直接碰 DOM，也不依赖虚拟化 controller。
 */
export function ensureCellSelection(editor: TableToolbarEditor): boolean {
  const { state, view } = editor;
  if (state.selection instanceof CellSelection) return true;

  const cellPos = findCurrentCellPos(state);
  if (cellPos === null) return false;

  const $cell = state.doc.resolve(cellPos);
  const tr = state.tr.setSelection(new CellSelection($cell));
  view.dispatch(tr);
  return true;
}

/**
 * 多单元格选区在“上方插入行”前需要先收缩到左上角单元格。
 *
 * 原因：ProseMirror 的 addRowBefore 以当前 selection anchor 为准；如果不显式收缩，
 * 多行选区下可能插入到用户不期望的位置。
 */
export function collapseSelectionToTopLeftCell(editor: TableToolbarEditor): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!(selection instanceof CellSelection)) return false;

  const rect = selectedRect(state);
  const tableNode = selection.$anchorCell.node(-1);
  const tableStart = selection.$anchorCell.start(-1);
  const map = TableMap.get(tableNode);

  const cellPosInTable = getCellOffsetAtLogicalPosition(map, rect.top, rect.left);
  if (cellPosInTable === null) return false;

  const cellNodeStartPos = tableStart + cellPosInTable;
  const $cell = state.doc.resolve(cellNodeStartPos);
  const tr = state.tr.setSelection(new CellSelection($cell));
  view.dispatch(tr);
  return true;
}

export function executeTableToolbarCommand(
  editor: TableToolbarEditor | null | undefined,
  commandFn: TableToolbarCommand
): boolean {
  if (!editor) {
    console.warn('[TableSimpleToolbar] editor 不可用，无法执行表格命令');
    return false;
  }

  if (!ensureCellSelection(editor)) {
    console.warn('[TableSimpleToolbar] 当前选区不在表格单元格内，表格命令已取消');
    return false;
  }

  try {
    return commandFn(editor) !== false;
  } catch (error) {
    console.error('[TableSimpleToolbar] 执行表格命令失败:', error);
    return false;
  }
}
