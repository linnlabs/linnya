/**
 * CodeBlockKeys.js
 * 
 * 提供处理 CodeBlock 内部特殊按键的函数。
 */

import { TextSelection } from 'prosemirror-state';
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils';
import { PositionResolver } from '../../../extensions/position/PositionResolver';

/**
 * 处理 CodeBlock 内部的 Enter 键 (非 Shift)。
 * 插入一个换行符。
 * @param {object} context - 包含 event, editor, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleCodeBlockEnter({ event, editor, debugLog }) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    editor.chain().insertContent('\n').run();
    return true; 
  }
  return false;
}

/**
 * 处理 CodeBlock 内部的 Shift + Enter 键。
 * 目标：退出当前 CodeBlock，并在其后创建一个新的 BaseBlock。
 * @param {object} context - 包含 event, editor, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleCodeBlockShiftEnter({ event, editor, debugLog }) {
  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault();

    const { state, view } = editor;
    const { selection, schema, tr } = state;
    const { $head } = selection; 

    const positionResolver = new PositionResolver(editor);
    const rootBlockInfo = positionResolver.getNearestRootBlockPos($head.pos);

    if (!rootBlockInfo || !rootBlockInfo.node || rootBlockInfo.pos === undefined) {
      return false; 
    }

    const currentRootBlockNode = rootBlockInfo.node;
    const currentRootBlockPos = rootBlockInfo.pos;
    const currentRootBlockEndPos = currentRootBlockPos + currentRootBlockNode.nodeSize;
    
    const newBaseBlockId = generateBlockId();
    const newRootBlockId = generateRootBlockId();

    const baseBlockNode = schema.nodes.baseBlock.createAndFill({ 
        id: newBaseBlockId, 
        blockType: 'base' 
    });

    if (!baseBlockNode) {
        return false;
    }
    
    const rootBlockNode = schema.nodes.rootBlock.createAndFill({ 
        id: newRootBlockId,
    }, baseBlockNode);

    if (!rootBlockNode) {
        return false;
    }

    tr.insert(currentRootBlockEndPos, rootBlockNode);
    
    const newCursorPos = currentRootBlockEndPos + 2;
    
    tr.setSelection(TextSelection.create(tr.doc, newCursorPos));
    tr.scrollIntoView();    
    view.dispatch(tr);
    return true;
  }
  return false;
} 