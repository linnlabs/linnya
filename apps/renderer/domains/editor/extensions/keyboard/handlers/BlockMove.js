/**
 * BlockMove.js
 * 
 * 提供处理块移动快捷键 (Alt + Up/Down) 的函数。
 * 借鉴 dragUtils 的逻辑，通过查找所有 rootBlock 并计算索引来移动。
 */
import { NodeSelection, TextSelection } from 'prosemirror-state';
// PositionUtils 和 NodeFinder 会通过 handlerContext 传入

/**
 * 处理 Alt + ArrowUp 快捷键，向上移动块。
 * @param {object} context - 包含 event, state, dispatch, $cursor, selection, getPosUtils, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleMoveBlockUp({ event, state, dispatch, $cursor, selection, getPosUtils, debugLog }) {
  if (!(event.altKey && event.key === 'ArrowUp')) {
    return false;
  }

  if (!$cursor) return false; // 需要光标

  event.preventDefault(); // 阻止默认滚动行为

  const posUtils = getPosUtils();
  const nodeFinder = posUtils.finder; // 获取 NodeFinder 实例

  // 1. 获取当前块信息 (RootBlock 和 ContentBlock)
  const currentBlockInfo = posUtils.getBlockInfoFromPos($cursor.pos);
  if (!currentBlockInfo?.rootBlock?.node || currentBlockInfo.rootBlock.pos == null || !currentBlockInfo.contentBlock?.node || currentBlockInfo.contentBlock.pos == null) {
    return true;
  }
  const currentBlockId = currentBlockInfo.rootBlock.node.attrs.id;
  const { node: currentNode, pos: currentPos } = currentBlockInfo.rootBlock;
  const currentEndPos = currentPos + currentNode.nodeSize;
  const { node: contentNode, pos: contentStartPos } = currentBlockInfo.contentBlock;
  const contentNodeTextStartPos = contentStartPos + 1; // 文本内容的起始位置

  // 记录相对位置
  let relativeOffset = -1;
  if (selection.empty && $cursor && $cursor.pos >= contentNodeTextStartPos) {
      relativeOffset = $cursor.pos - contentNodeTextStartPos;
      relativeOffset = Math.max(0, Math.min(relativeOffset, contentNode.content.size));
  }

  // 2. 获取所有 RootBlocks 并找到当前块索引
  const allRootBlocks = nodeFinder.findAllNodesOfType('rootBlock');
  const currentIndex = allRootBlocks.findIndex(block => block.node.attrs.id === currentBlockId);

  if (currentIndex === -1) {
    return true;
  }

  // 3. 计算目标索引
  const targetIndex = currentIndex - 1;

  // 4. 验证目标索引
  if (targetIndex < 0) {
    return true; // 已经是第一个块，无法上移
  }

  // 5. 获取目标块信息并确定插入位置
  const targetBlock = allRootBlocks[targetIndex];
  const insertPos = targetBlock.pos; // 向上移动，插入到目标块之前

  // 6. 执行事务
  try {
    const tr = state.tr;
    // 删除当前块
    const mappedCurrentPos = tr.mapping.map(currentPos);
    const mappedCurrentEndPos = tr.mapping.map(currentEndPos);
    tr.delete(mappedCurrentPos, mappedCurrentEndPos);

    // 在目标位置插入
    const mappedInsertPos = tr.mapping.map(insertPos);
    tr.insert(mappedInsertPos, currentNode);
    
    // 恢复光标
    if (relativeOffset !== -1) {
      const newContentStartPos = mappedInsertPos + 1;
      const newContentNodeTextStartPos = newContentStartPos + 1;
      let newAbsolutePos = newContentNodeTextStartPos + relativeOffset;
      const newContentSize = contentNode.content.size;
      newAbsolutePos = Math.min(newContentNodeTextStartPos + newContentSize, Math.max(newContentNodeTextStartPos, newAbsolutePos));
      tr.setSelection(TextSelection.create(tr.doc, newAbsolutePos));
    } else {
      tr.setSelection(NodeSelection.create(tr.doc, mappedInsertPos));
    }
    dispatch(tr);
    return true;
  } catch (error) {
    console.error('[MoveBlockUp] 执行移动事务时出错:', error);
    return true;
  }
}

/**
 * 处理 Alt + ArrowDown 快捷键，向下移动块。
 * @param {object} context - 包含 event, state, dispatch, $cursor, selection, getPosUtils, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleMoveBlockDown({ event, state, dispatch, $cursor, selection, getPosUtils, debugLog }) {
  if (!(event.altKey && event.key === 'ArrowDown')) {
    return false;
  }

  if (!$cursor) return false;

  event.preventDefault(); // 阻止默认滚动行为

  const posUtils = getPosUtils();
  const nodeFinder = posUtils.finder;

  // 1. 获取当前块信息 (RootBlock 和 ContentBlock)
  const currentBlockInfo = posUtils.getBlockInfoFromPos($cursor.pos);
  if (!currentBlockInfo?.rootBlock?.node || currentBlockInfo.rootBlock.pos == null || !currentBlockInfo.contentBlock?.node || currentBlockInfo.contentBlock.pos == null) {
    return true;
  }
  const currentBlockId = currentBlockInfo.rootBlock.node.attrs.id;
  const { node: currentNode, pos: currentPos } = currentBlockInfo.rootBlock;
  const currentEndPos = currentPos + currentNode.nodeSize;
  const { node: contentNode, pos: contentStartPos } = currentBlockInfo.contentBlock;
  const contentNodeTextStartPos = contentStartPos + 1; // 文本内容的起始位置

  // 记录相对位置
  let relativeOffset = -1;
  if (selection.empty && $cursor && $cursor.pos >= contentNodeTextStartPos) {
      relativeOffset = $cursor.pos - contentNodeTextStartPos;
      relativeOffset = Math.max(0, Math.min(relativeOffset, contentNode.content.size));
  }

  // 2. 获取所有 RootBlocks 并找到当前块索引
  const allRootBlocks = nodeFinder.findAllNodesOfType('rootBlock');
  const currentIndex = allRootBlocks.findIndex(block => block.node.attrs.id === currentBlockId);

  if (currentIndex === -1) {
    return true;
  }

  // 3. 计算目标索引
  const targetIndex = currentIndex + 1;

  // 4. 验证目标索引
  if (targetIndex >= allRootBlocks.length) {
    return true; // 已经是最后一个块，无法下移
  }

  // 5. 获取目标块信息并确定插入位置
  const targetBlock = allRootBlocks[targetIndex];
  // 向下移动，插入到目标块之后，即目标块的结束位置
  const insertPos = targetBlock.pos + targetBlock.node.nodeSize; 

  // 6. 执行事务
  try {
    const tr = state.tr;
    // 删除当前块
    const mappedCurrentPos = tr.mapping.map(currentPos);
    const mappedCurrentEndPos = tr.mapping.map(currentEndPos);
    tr.delete(mappedCurrentPos, mappedCurrentEndPos);

    // 在目标位置插入
    const mappedInsertPos = tr.mapping.map(insertPos);
    tr.insert(mappedInsertPos, currentNode);

    // 恢复光标
    if (relativeOffset !== -1) {
      const newContentStartPos = mappedInsertPos + 1;
      const newContentNodeTextStartPos = newContentStartPos + 1;
      let newAbsolutePos = newContentNodeTextStartPos + relativeOffset;
      const newContentSize = contentNode.content.size;
      newAbsolutePos = Math.min(newContentNodeTextStartPos + newContentSize, Math.max(newContentNodeTextStartPos, newAbsolutePos));
      tr.setSelection(TextSelection.create(tr.doc, newAbsolutePos));
    } else {
      tr.setSelection(NodeSelection.create(tr.doc, mappedInsertPos));
    }
    dispatch(tr);
    return true;
  } catch (error) {
    console.error('[MoveBlockDown] 执行移动事务时出错:', error);
    return true;
  }
}
