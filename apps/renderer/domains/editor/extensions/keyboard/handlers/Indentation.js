/* src/renderer/extensions/interaction/Keyboard/Indentation.js */
/**
 * Indentation.js
 * 
 * 提供处理块缩进快捷键 (Tab, Shift+Tab) 的函数。
 */
// 移除 Extension 和 Plugin 相关导入
// import { Extension } from '@tiptap/core';
// import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { findParentNode } from '@tiptap/core';

// 定义调试标志和日志函数 (与原 KeyboardListener 保持一致)
const DEBUG = false; 
const debugLog = (...args) => {
  if (DEBUG) {
    console.log('[IndentationExtension]', ...args);
  }
};

/**
 * 处理 Tab 键。
 * - 在 ListItemBlock 中：增加层级。
 * - 在 BaseBlock/HeadingBlock 中：增加 indent 属性。
 * - 在 QuoteBlock 中: 增加 indent 属性 (从旧 KeyboardListener 迁移)。
 * - 其他情况：允许默认行为。
 * @param {object} context - 包含 event, state, dispatch, selection, $cursor, editor, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleTab({ event, state, dispatch, selection, $cursor, editor, debugLog }) {
  if (event.key !== 'Tab' || event.shiftKey) {
    return false;
  }

  if (!$cursor) return false; // 需要光标

  // 1. 处理列表项缩进
  if ($cursor.parent.type.name === 'listItemBlock') {
    event.preventDefault(); 
    debugLog('Tab: Indenting listItemBlock');
    
    const listItemInfo = findParentNode(node => node.type.name === 'listItemBlock')(selection);
    if (listItemInfo) {
      const { node, pos } = listItemInfo;
      const currentLevel = node.attrs.level || 0;
      const newLevel = Math.min(currentLevel + 1, 3); 
      
      if (newLevel !== currentLevel) {
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: newLevel });
        dispatch(tr);
      } else {
        debugLog('Tab: Max list level reached.');
      }
    }
    return true; // 事件已处理
  }
  
  // 2. 处理 BaseBlock/HeadingBlock 缩进
  if ($cursor.parent.type.name === 'baseBlock' || $cursor.parent.type.name === 'headingBlock') {
     event.preventDefault(); 
     debugLog('Tab: Indenting paragraph block using updateAttributes.');
     
     const currentContentNode = $cursor.parent;
     const currentIndent = currentContentNode.attrs.indent || 0;
     const newIndent = Math.min(currentIndent + 1, 6); 
       
     if (newIndent !== currentIndent) {
        try {
            if (!editor.commands.updateAttributes) {
                console.error('[Indentation Tab] updateAttributes command is not registered!');
                return true; 
            }
            if (editor.commands.updateAttributes(currentContentNode.type.name, { indent: newIndent })) {
                debugLog('Indent successful using updateAttributes.');
            } else {
                console.error('[Indentation Tab] updateAttributes command failed.');
            }
        } catch(e) {
            console.error('Error during updateAttributes on Tab:', e);
        }
     } else {
        debugLog('Tab: Max indent level reached.');
     }
     return true; // 事件已处理
  }

  // 3. 处理 QuoteBlock 缩进 (从旧 KeyboardListener 迁移)
  if ($cursor.parent.type.name === 'quoteBlock') {
    event.preventDefault(); 
    debugLog('Tab: Indenting quoteBlock');
    
    const quoteBlockInfo = findParentNode(node => node.type.name === 'quoteBlock')(selection);
    if (quoteBlockInfo) {
      const { node, pos } = quoteBlockInfo;
      const currentIndent = node.attrs.indent || 0;
      const newIndent = Math.min(6, currentIndent + 1); 
      
      if (newIndent !== currentIndent) {
          const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: newIndent });
          dispatch(tr);
      } else {
         debugLog('Tab: Max quote indent level reached.');
      }
    }
    return true; // 事件已处理
  }
  
  // 如果不在可处理的块中，允许默认 Tab 行为
  debugLog('Tab: No special handling, allowing default behavior.');
  return false; 
}

/**
 * 处理 Shift + Tab 键。
 * - 在 ListItemBlock 中：level > 0 则减少 level，level === 0 则转为 baseBlock。
 * - 在 BaseBlock/HeadingBlock 中：减少 indent 属性。
 * - 在 QuoteBlock 中: 减少 indent 属性 (从旧 KeyboardListener 迁移)。
 * - 其他情况：允许默认行为。
 * @param {object} context - 包含 event, state, dispatch, selection, $cursor, editor, debugLog 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export function handleShiftTab({ event, state, dispatch, selection, $cursor, editor, debugLog }) {
  if (event.key !== 'Tab' || !event.shiftKey) {
    return false;
  }

  if (!$cursor) return false;
  
  // 1. 处理列表项提升
  if ($cursor.parent.type.name === 'listItemBlock') {
    event.preventDefault(); 
    debugLog('Shift+Tab: Outdenting listItemBlock');
    
    const listItemInfo = findParentNode(node => node.type.name === 'listItemBlock')(selection);
    if (listItemInfo) {
      const { node, pos } = listItemInfo;
      const currentLevel = node.attrs.level || 0;
      const newLevel = currentLevel - 1;
      
      if (newLevel >= 0) {
        // 减少缩进级别
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: newLevel });
        dispatch(tr);
      } else {
        // Level 已经是 0，转换为 baseBlock
        debugLog('Shift+Tab: Level 0, converting to baseBlock.');
        try {
          if (!editor.commands.setBaseBlock()) {
            debugLog('Shift+Tab: Conversion to baseBlock failed.');
          }
        } catch (error) {
          console.error('Error converting listItem to baseBlock on Shift+Tab:', error);
        }
      }
    }
    return true; // 事件已处理
  }
  
  // 2. 处理 BaseBlock/HeadingBlock 反向缩进
  if ($cursor.parent.type.name === 'baseBlock' || $cursor.parent.type.name === 'headingBlock') {
     event.preventDefault(); 
     debugLog('Shift+Tab: Outdenting paragraph block using updateAttributes.');
     
     const currentContentNode = $cursor.parent;
     const currentIndent = currentContentNode.attrs.indent || 0;
     const newIndent = Math.max(currentIndent - 1, 0); 
       
     if (newIndent !== currentIndent) {
         try {
             if (!editor.commands.updateAttributes) {
                 console.error('[Indentation Shift+Tab] updateAttributes command is not registered!');
                 return true; 
             }
             if (editor.commands.updateAttributes(currentContentNode.type.name, { indent: newIndent })) {
                 debugLog('Outdent successful using updateAttributes.');
             } else {
                 console.error('[Indentation Shift+Tab] updateAttributes command failed.');
             }
         } catch(e) {
             console.error('Error during updateAttributes on Shift+Tab:', e);
         }
     } else {
         debugLog('Shift+Tab: Min indent level reached.');
     }
     return true; // 事件已处理
  }

  // 3. 处理 QuoteBlock 反向缩进 (从旧 KeyboardListener 迁移)
  if ($cursor.parent.type.name === 'quoteBlock') {
    event.preventDefault(); 
    debugLog('Shift+Tab: Outdenting quoteBlock');
    
    const quoteBlockInfo = findParentNode(node => node.type.name === 'quoteBlock')(selection);
    if (quoteBlockInfo) {
      const { node, pos } = quoteBlockInfo;
      const currentIndent = node.attrs.indent || 0;
      
      if (currentIndent > 0) {
        // 减少缩进级别
        const tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: currentIndent - 1 });
        dispatch(tr);
      } else {
         debugLog('Shift+Tab: Min quote indent level reached.');
      }
    }
    return true; // 事件已处理
  }
   
  // 如果不在可处理的块中，允许默认 Shift+Tab 行为
  debugLog('Shift+Tab: No special handling, allowing default behavior.');
  return false;
}

// 移除 Extension 定义
// export const IndentationExtension = Extension.create(...);
// export default IndentationExtension;
