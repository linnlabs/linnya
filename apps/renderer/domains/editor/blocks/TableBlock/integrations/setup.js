/**
 * @file apps/renderer/features/TableBlock/integrations/setup.js
 * 
 * @brief Table AI 高亮运行时的编辑器注册入口
 * 
 * @description
 * editorFactory 通过此入口把编辑器实例注册到 table-ai-mode feature；
 * 模式状态和表身份由 feature 会话持有，此处不复制业务状态。
 */

import { tableAiHighlightRuntime } from '../../../features/table-ai-mode';

/**
 * 设置TableBlock的AI集成
 * @param {Object} options - 设置选项
 * @param {Object} options.editor - 编辑器实例
 * @param {string} options.editorId - 编辑器ID（可选，默认为'main'）
 */
export function setupTableAiHighlightRuntime(options) {
  const { editor, editorId = 'main' } = options;
  
  if (!editor) {
    console.warn('[TableBlock Setup] 编辑器实例不能为空');
    return;
  }
  
  // 注册编辑器实例
  tableAiHighlightRuntime.registerEditor(editorId, editor);
  
  console.log(`[TableBlock Setup] Table AI 高亮运行时已注册，编辑器ID: ${editorId}`);
  
  // 返回清理函数
  return () => {
    tableAiHighlightRuntime.unregisterEditor(editorId);
    console.log(`[TableBlock Setup] Table AI 高亮运行时已注销，编辑器ID: ${editorId}`);
  };
}
