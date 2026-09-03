// src/renderer/extensions/interaction/commands/MergeCommands.js
/**
 * MergeCommands.js
 * 
 * 定义块合并相关命令，使用ProseMirror的事务操作实现块的合并
 */

import { PositionUtils } from '../../position/PositionUtils';
import { emitBlockOperation, BlockAction } from '../../../shared/utils/blockEventUtils';
import { findParentNode } from '@tiptap/core'; // 需要导入 findParentNode

// 调试标志
const DEBUG = true;

/**
 * 记录日志
 */
const log = (...args) => {
  if (DEBUG) {
    console.log('[MergeCommands]', ...args);
  }
};

/**
 * 合并当前块与下一个块
 * 当光标在块末尾按下Delete键时调用
 * 
 * @param {number} pos - 当前光标位置 (通常是当前块的末尾)
 * @returns {Function} - 返回可执行的命令
 */
export const mergeWithNextBlock = () => ({ state, dispatch, editor }) => {
  try {
    const { doc, selection } = state;
    const { $from } = selection;

    if (!$from || $from.parentOffset !== $from.parent.content.size) {
        // log('mergeWithNextBlock: 光标不在块尾，不发送事件。');
        return false;
    }

    const positionUtils = new PositionUtils(editor);
    const currentBlockRootInfo = findParentNode(node => node.type.name === 'rootBlock')(selection);

    if (!currentBlockRootInfo || !currentBlockRootInfo.node) {
        log('mergeWithNextBlock: 找不到当前 RootBlock。');
        return false;
    }
    const currentBlockId = currentBlockRootInfo.node.attrs.id;

    let nextRootBlockNode = null;
    const startSearchPos = currentBlockRootInfo.pos + currentBlockRootInfo.node.nodeSize;

    doc.nodesBetween(startSearchPos, doc.content.size, (node, pos) => {
        if (node.type.name === 'rootBlock') {
            nextRootBlockNode = node;
            return false; // 找到第一个就停止
        }
        return true;
    });

    // 如果后面是可合并的非HR块，则发送事件
    if (nextRootBlockNode && nextRootBlockNode.content?.firstChild?.type?.name !== 'horizontalRuleBlock') {
        const nextBlockId = nextRootBlockNode.attrs.id;
        log(`mergeWithNextBlock: 准备为块 ${currentBlockId} 和下一个块 ${nextBlockId} 发送事件。`);
        emitBlockOperation(editor, BlockAction.MERGE, nextBlockId, {
            targetBlockId: currentBlockId,
            position: $from.pos
        });
        emitBlockOperation(editor, BlockAction.DELETE, nextBlockId, {
            reason: 'merge-delete-event-only',
            mergedIntoId: currentBlockId
        });
    } else {
        // log('mergeWithNextBlock: 后面是HR或没有可合并的块，不发送事件。');
    }
  } catch (error) {
    console.error('mergeWithNextBlock 发送事件时出错:', error);
  }
  return false; // 总是返回false，让ProseMirror默认行为处理DOM
};

/**
 * 合并当前块与前一个块
 * 当光标在块开始位置按下Backspace键时调用
 * 
 * @param {number} pos - 当前光标位置
 * @returns {Function} - 返回可执行的命令
 */
export const mergeWithPreviousBlock = () => ({ state, dispatch, editor }) => {
  try {
    const { doc, selection } = state;
    const { $from } = selection;

    if (!$from || $from.parentOffset !== 0) { // 确保在块首
        // log('mergeWithPreviousBlock: 光标不在块首，不发送事件。');
        return false;
    }

    const positionUtils = new PositionUtils(editor);
    const currentBlockRootInfo = findParentNode(node => node.type.name === 'rootBlock')(selection);

    if (!currentBlockRootInfo || !currentBlockRootInfo.node) {
        log('mergeWithPreviousBlock: 找不到当前 RootBlock。');
        return false;
    }
    const currentBlockId = currentBlockRootInfo.node.attrs.id;
    const currentBlockPos = currentBlockRootInfo.pos;

    let prevBlockNode = null;
    let prevBlockPos = -1;
    if (currentBlockPos > 0) {
        doc.nodesBetween(0, currentBlockPos, (node, pos) => {
            if (node.type.name === 'rootBlock' && pos < currentBlockPos) {
                prevBlockNode = node;
                prevBlockPos = pos;
            }
            return true;
        });
    }

    // 如果前面是可合并的非HR块，则发送事件
    if (prevBlockNode && prevBlockPos !== -1 && prevBlockNode.content?.firstChild?.type?.name !== 'horizontalRuleBlock') {
        log(`mergeWithPreviousBlock: 准备为块 ${currentBlockId} 和前一个块 ${prevBlockNode.attrs.id} 发送事件。`);
        emitBlockOperation(editor, BlockAction.DELETE, currentBlockId, {
            reason: 'merge-backspace-event-only',
            position: $from.pos
        });
        emitBlockOperation(editor, BlockAction.MERGE, currentBlockId, {
            targetBlockId: prevBlockNode.attrs.id,
            position: $from.pos
        });
    } else {
        // log('mergeWithPreviousBlock: 前面是HR或没有可合并的块，不发送事件。');
    }
  } catch (error) {
    console.error('mergeWithPreviousBlock 发送事件时出错:', error);
  }
  return false; // 总是返回false，让ProseMirror默认行为处理DOM
};

// 导出所有命令
export default {
  mergeWithNextBlock,
  mergeWithPreviousBlock
};


