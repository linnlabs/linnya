//src/renderer/features/TableBlock/tableNavigators.js

import { TextSelection } from 'prosemirror-state';
import { positionTextSelectionWithHandshake } from '../../features/RenderVirtualization';
import { getTableMap } from './position/tableMapUtils';
import { getCellNavigationTargetAtLogicalPosition } from './position/tableNavigationUtils';

/**
 * 将光标安全地设置到指定位置。
 * @param {object} context - 包含 dispatch, state, event 的上下文对象
 * @param {number} position - 目标位置
 */
function setCursor(context, position) {
  const { dispatch, state, event, editor } = context;

  if (editor) {
    event.preventDefault();
    void positionTextSelectionWithHandshake(editor, position).then((result) => {
      if (!result.ok) {
        console.warn('[TableNavigators] hydrate-before-selection failed:', result);
      }
    });
    return true;
  }

  try {
    const tr = state.tr.setSelection(TextSelection.create(state.doc, position)).scrollIntoView();
    dispatch(tr);
    event.preventDefault();
    return true;
  } catch (e) {
    // 错误日志可以更具体
    console.error(`[TableNavigators] Error setting selection to pos ${position}:`, e);
    return false;
  }
}

/**
 * 获取表格中特定单元格内容的导航位置。
 *
 * 中文说明：
 * - 这里解析的是“用户看到的逻辑格子”，不是结构插入位置；
 * - 合并单元格覆盖最后一格时，必须落到真实覆盖 cell 内部；
 * - 因此统一走 tableNavigationUtils，而不是直接调用 TableMap.positionAt。
 *
 * @param {import('@tiptap/pm/state').EditorState} state - 当前编辑器状态
 * @param {{contentNode: object, nodePos: number}} blockInfo - 包含 tableNode 和 tablePos 的对象
 * @param {'first-start' | 'last-end'} navType - 导航类型
 * @returns {number | null}
 */
function getTableNavPosition(state, blockInfo, navType) {
  const { contentNode: tableNode, nodePos: tablePos } = blockInfo;
  const map = getTableMap(tableNode);
  if (!map || map.height === 0 || map.width === 0) return null;

  if (navType === 'first-start') {
    const target = getCellNavigationTargetAtLogicalPosition(
      state,
      tableNode,
      tablePos,
      0,
      0
    );
    return target ? target.contentStart : null;
  }

  if (navType === 'last-end') {
    const lastRowIndex = map.height - 1;
    const lastColIndex = map.width - 1;
    const target = getCellNavigationTargetAtLogicalPosition(
      state,
      tableNode,
      tablePos,
      lastRowIndex,
      lastColIndex
    );
    return target ? target.contentEnd : null;
  }

  return null;
}

/**
 * 从外部导航进入表格时的处理器。
 * @param {object} context - 处理器上下文
 * @param {{contentNode: object, nodePos: number}} blockInfo - 表格节点信息
 * @param {'start' | 'end'} target - 'start' 表示进入表格开头, 'end' 表示进入表格末尾
 * @returns {boolean}
 */
export function navigateIntoTable(context, blockInfo, target) {
  const navType = target === 'start' ? 'first-start' : 'last-end';
  const position = getTableNavPosition(context.state, blockInfo, navType);
  if (position !== null) {
    return setCursor(context, position);
  }
  return false;
}
