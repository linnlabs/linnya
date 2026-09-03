// src/renderer/extensions/interaction/commands/HorizontalRuleCommands.js
/**
 * HorizontalRuleCommands.js
 * 
 * 定义插入水平分割线相关的命令
 * "insertHorizontalRuleBeforeAndConvertNext" 命令：
 * - 在当前光标所在 rootBlock 之前插入一个新的 rootBlock，其中包含一个 horizontalRuleBlock。
 * - 将原光标所在的 rootBlock 中的 contentBlock 转换为 baseBlock (如果它还不是的话)。
 * - 将光标定位到转换后的 baseBlock 的开头。
 */

import { TextSelection } from 'prosemirror-state';
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils';
import { findParentNode } from '@tiptap/core';
// 假设 schema.js 导出了 NODE_TYPES 或 NODE_GROUPS，其中包含 rootBlock 和 baseBlock 的名称
// 例如: import { NODE_TYPES } from '../../schema';
// 为简化，我们暂时硬编码这些名称，但理想情况下应从 schema.js 动态获取
const ROOT_BLOCK_TYPE_NAME = 'rootBlock'; // 应从 schema.js 获取
const BASE_BLOCK_TYPE_NAME = 'baseBlock'; // 应从 schema.js 获取

export const executeInsertHorizontalRuleBeforeAndConvertNext = (options = {}) => ({ state, tr, dispatch, editor }) => {
  const { range } = options; 

  if (range && range.from !== undefined && range.to !== undefined) {
    tr.deleteRange(range.from, range.to);
  }

  const currentSelection = tr.selection; 
  const rootBlockInfo = findParentNode(node => node.type.name === ROOT_BLOCK_TYPE_NAME)(currentSelection);
  if (!rootBlockInfo) {
    return false;
  }
  
  const schema = state.schema;
  const { pos: originalRootBlockPos } = rootBlockInfo;
  
  const hrNode = schema.nodes.horizontalRuleBlock.create({ 
    id: generateBlockId(),
    blockType: 'horizontalRule' // schema中定义的类型名通常是 horizontalRule
  });
  
  const hrRootBlockNode = schema.nodes[ROOT_BLOCK_TYPE_NAME].create({ 
    id: generateRootBlockId() 
  }, [hrNode]);
  
  tr.insert(originalRootBlockPos, hrRootBlockNode);
  
  const originalRootBlockNewPos = originalRootBlockPos + hrRootBlockNode.nodeSize;
  const resolvedOriginalRootBlockStart = tr.doc.resolve(originalRootBlockNewPos);
  const originalRootBlockNode = tr.doc.nodeAt(resolvedOriginalRootBlockStart.pos);

  if (originalRootBlockNode && originalRootBlockNode.firstChild) {
  const contentBlockNode = originalRootBlockNode.firstChild;
    const contentBlockPos = resolvedOriginalRootBlockStart.pos + 1; // Position of the content block inside its rootBlock

    // 仅当它还不是 baseBlock 时才转换
    if (contentBlockNode.type.name !== BASE_BLOCK_TYPE_NAME) {
      const newBaseBlockNode = schema.nodes[BASE_BLOCK_TYPE_NAME].create(
        { id: contentBlockNode.attrs.id || generateBlockId() }, // 保留 ID
        contentBlockNode.content // 保留内容
  );
  tr.replaceWith(contentBlockPos, contentBlockPos + contentBlockNode.nodeSize, newBaseBlockNode);
    }

    // 将光标设置在转换后（或原样）的块的开头
    // 需要加1跳过 rootBlock 的开标签，再加1跳过 contentBlock 的开标签，才是内容开始的位置
    const selectionPos = contentBlockPos + 1;
    tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));
    tr.scrollIntoView();
  } else {
    const afterHrPos = originalRootBlockPos + hrRootBlockNode.nodeSize;
    tr.setSelection(TextSelection.near(tr.doc.resolve(afterHrPos)));
  tr.scrollIntoView();
  }
  
  return true;
};

// 导出命令
export default {
  executeInsertHorizontalRuleBeforeAndConvertNext
};