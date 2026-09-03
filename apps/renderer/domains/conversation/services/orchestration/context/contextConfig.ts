/**
 * @file apps/renderer/domains/conversation/services/orchestration/context/contextConfig.ts
 * @brief 侧边栏对话的文档上下文配置
 * 
 * @description
 * 🎯 定义传给 shared/utils/aiContextUtils.js 的配置参数
 * 直接调用: getDefaultBlockContext(editor, SIDEBAR_DOCUMENT_CONTEXT_OPTIONS)
 */

/**
 * 🎯 侧边栏文档上下文配置
 * 
 * 你可以直接修改这些数值来调整上下文获取策略
 */
export const SIDEBAR_DOCUMENT_CONTEXT_OPTIONS = {
  blocksBefore: 50,        // 🎯 获取参考点（视图中心）前面50个块  
  blocksAfter: 30,         // 🎯 获取参考点（视图中心）后面30个块
  charsLimitBefore: 5000,  // 📝 前文最大5000字符
  charsLimitAfter: 3000,   // 📝 后文最大3000字符
  includeCurrentBlock: true,
  separateCurrentBlock: false
};

/**
 * 📊 获取侧边栏文档上下文配置
 */
export function getSidebarDocumentContextOptions() {
  return SIDEBAR_DOCUMENT_CONTEXT_OPTIONS;
} 
