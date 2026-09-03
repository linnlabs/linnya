/**
 * RevisionCommands.js
 * 
 * AI 修订模式相关命令
 * 用于处理 revisionMark 的批量接受/拒绝操作
 * 
 * 命令列表：
 * - acceptAllRevisionsInBlock: 接受块内所有修订
 * - rejectAllRevisionsInBlock: 拒绝块内所有修订
 * - restoreBlockContent: 恢复块内容到指定版本
 * - clearBlockRevisionMarks: 清除块内所有修订标记
 */

import { Fragment } from 'prosemirror-model';
import {
  findRevisionMarkOnNode,
  hasUnmarkedMeaningfulInlineContent,
} from '../../../features/Revision/utils/revisionInlineNodes';

/**
 * 接受该 block 内所有修订
 * - insert 类型：移除 mark，保留文字
 * - delete 类型：删除文字
 * 
 * @param {number} blockPos - RootBlock 在文档中的位置
 * @param {string} revisionId - 修订会话 ID（只处理该 ID 的修订）
 * @returns {import('@tiptap/core').RawCommands['acceptAllRevisionsInBlock']}
 */
export const acceptAllRevisionsInBlock = (blockPos, revisionId) => {
  return ({ tr, dispatch, state }) => {
    if (!dispatch) return true;

    const rootBlockNode = state.doc.nodeAt(blockPos);
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      console.warn('[RevisionCommands] acceptAllRevisionsInBlock: 未找到有效的 rootBlock 节点');
      return false;
    }

    const revisionMarkType = state.schema.marks.revisionMark;
    if (!revisionMarkType) {
      console.warn('[RevisionCommands] acceptAllRevisionsInBlock: revisionMark 类型未注册');
      return false;
    }

    const blockStart = blockPos;
    const blockEnd = blockPos + rootBlockNode.nodeSize;

    // 收集所有需要处理的修订标记（倒序处理，避免位置偏移问题）
    const revisionRanges = [];
    // 额外标记：用于判断是否是「整块删除」类型的修订
    let hasDelete = false;
    let hasNonRevisionInlineContent = false;
    let onlyDeleteMarks = true;

    state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
      const revisionMark = findRevisionMarkOnNode(node, revisionMarkType, revisionId);
      if (revisionMark) {
        revisionRanges.push({
          from: pos,
          to: pos + node.nodeSize,
          changeType: revisionMark.attrs.changeType,
        });

        if (revisionMark.attrs.changeType === 'delete') {
          hasDelete = true;
        } else {
          // 一旦出现非 delete 类型（例如 insert），则不是“整块删除”
          onlyDeleteMarks = false;
        }
      } else if (hasUnmarkedMeaningfulInlineContent(node, revisionMarkType, revisionId)) {
        // 块内仍有未被本 revision 覆盖的 inline 内容，说明不是“整块删除”
        hasNonRevisionInlineContent = true;
      }
    });

    // 如果：
    // - 至少有一个 delete 类型的修订；
    // - 块内不存在未被本 revision 标记的文本内容；
    // - 且所有标记都是 delete 类型；
    // 则可以将此视为「整块删除」修订，接受时应该物理删除整个 rootBlock。
    const isWholeBlockDelete = hasDelete && !hasNonRevisionInlineContent && onlyDeleteMarks;

    if (isWholeBlockDelete) {
      // 直接删除整个 rootBlock（包括其内容和包裹节点）
      tr.delete(blockStart, blockEnd);
      dispatch(tr);
      return true;
    }

    // 倒序处理，从后往前，避免位置偏移
    revisionRanges.sort((a, b) => b.from - a.from);

    for (const range of revisionRanges) {
      if (range.changeType === 'delete') {
        // 删除类型：接受 = 删除文字
        tr.delete(range.from, range.to);
      } else {
        // 插入类型：接受 = 移除 mark，保留文字
        tr.removeMark(range.from, range.to, revisionMarkType);
      }
    }

    // 必须提交 transaction，否则变更不会生效
    dispatch(tr);

    return true;
  };
};

/**
 * 拒绝该 block 内所有修订
 * - insert 类型：删除文字
 * - delete 类型：移除 mark，保留文字
 * 
 * @param {number} blockPos - RootBlock 在文档中的位置
 * @param {string} revisionId - 修订会话 ID（只处理该 ID 的修订）
 * @returns {import('@tiptap/core').RawCommands['rejectAllRevisionsInBlock']}
 */
export const rejectAllRevisionsInBlock = (blockPos, revisionId) => {
  return ({ tr, dispatch, state }) => {
    if (!dispatch) return true;

    const rootBlockNode = state.doc.nodeAt(blockPos);
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      console.warn('[RevisionCommands] rejectAllRevisionsInBlock: 未找到有效的 rootBlock 节点');
      return false;
    }

    const revisionMarkType = state.schema.marks.revisionMark;
    if (!revisionMarkType) {
      console.warn('[RevisionCommands] rejectAllRevisionsInBlock: revisionMark 类型未注册');
      return false;
    }

    const blockStart = blockPos;
    const blockEnd = blockPos + rootBlockNode.nodeSize;

    // 收集所有需要处理的修订标记（倒序处理，避免位置偏移问题）
    const revisionRanges = [];

    state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
      const revisionMark = findRevisionMarkOnNode(node, revisionMarkType, revisionId);
      if (revisionMark) {
        revisionRanges.push({
          from: pos,
          to: pos + node.nodeSize,
          changeType: revisionMark.attrs.changeType,
        });
      }
    });

    // 倒序处理，从后往前，避免位置偏移
    revisionRanges.sort((a, b) => b.from - a.from);

    for (const range of revisionRanges) {
      if (range.changeType === 'insert') {
        // 插入类型：拒绝 = 删除文字
        tr.delete(range.from, range.to);
      } else {
        // 删除类型：拒绝 = 移除 mark，保留文字
        tr.removeMark(range.from, range.to, revisionMarkType);
      }
    }

    // 必须提交 transaction，否则变更不会生效
    dispatch(tr);

    return true;
  };
};

/**
 * 恢复块内容
 * 用新的 JSON 内容替换该 block 的子内容
 * 
 * @param {number} blockPos - RootBlock 在文档中的位置
 * @param {string|object} newContentJson - 新的内容 JSON（RootBlock 的 content 数组）
 * @returns {import('@tiptap/core').RawCommands['restoreBlockContent']}
 */
export const restoreBlockContent = (blockPos, newContentJson) => {
  return ({ tr, dispatch, state }) => {
    if (!dispatch) return true;

    const rootBlockNode = state.doc.nodeAt(blockPos);
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      console.warn('[RevisionCommands] restoreBlockContent: 未找到有效的 rootBlock 节点');
      return false;
    }

    try {
      // 解析新内容
      const contentData = typeof newContentJson === 'string'
        ? JSON.parse(newContentJson)
        : newContentJson;

      // 从 JSON 创建 ProseMirror Fragment
      const newContent = Fragment.fromJSON(state.schema, contentData.content || [contentData]);

      // 替换 RootBlock 的内容
      // blockPos + 1 是 RootBlock 内容的起始位置
      // blockPos + rootBlockNode.nodeSize - 1 是内容的结束位置
      const contentStart = blockPos + 1;
      const contentEnd = blockPos + rootBlockNode.nodeSize - 1;

      tr.replaceWith(contentStart, contentEnd, newContent);

      // 必须提交 transaction，否则内容替换不生效
      dispatch(tr);

      return true;
    } catch (error) {
      console.error('[RevisionCommands] restoreBlockContent: 恢复内容失败:', error);
      return false;
    }
  };
};

/**
 * 清除块内所有修订标记
 * 
 * @param {number} blockPos - RootBlock 在文档中的位置
 * @param {string} [revisionId] - 可选，只清除指定 revisionId 的标记
 * @returns {import('@tiptap/core').RawCommands['clearBlockRevisionMarks']}
 */
export const clearBlockRevisionMarks = (blockPos, revisionId = null) => {
  return ({ tr, dispatch, state }) => {
    if (!dispatch) return true;

    const rootBlockNode = state.doc.nodeAt(blockPos);
    if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
      console.warn('[RevisionCommands] clearBlockRevisionMarks: 未找到有效的 rootBlock 节点');
      return false;
    }

    const revisionMarkType = state.schema.marks.revisionMark;
    if (!revisionMarkType) {
      console.warn('[RevisionCommands] clearBlockRevisionMarks: revisionMark 类型未注册');
      return false;
    }

    const blockStart = blockPos + 1;
    const blockEnd = blockPos + rootBlockNode.nodeSize - 1;

    if (revisionId) {
      // 只清除指定 revisionId 的标记
      state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
        const revisionMark = findRevisionMarkOnNode(node, revisionMarkType, revisionId);
        if (revisionMark) {
          tr.removeMark(pos, pos + node.nodeSize, revisionMarkType);
        }
      });
    } else {
      // 清除所有 revisionMark - 改为遍历清除，比直接 removeMark(range) 更安全，避免误伤边界
       state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
        const revisionMark = findRevisionMarkOnNode(node, revisionMarkType);
        if (revisionMark) {
          tr.removeMark(pos, pos + node.nodeSize, revisionMarkType);
        }
      });
    }

    // 必须提交 transaction，否则标记清除不生效
    dispatch(tr);

    return true;
  };
};
