/**
 * @file apps/renderer/features/AiInput/config/contextConfig.ts
 * @brief 编辑器写作功能的上下文配置
 */

export interface WritingContextConfig {
  blocksBefore: number;
  blocksAfter: number;
  charsLimitBefore: number;
  charsLimitAfter: number;
  includeCurrentBlock: boolean;
  separateCurrentBlock: boolean;
}

/**
 * 🎯 编辑器写作的上下文配置
 * 
 * 💡 写作使用中等上下文策略：
 * - 需要足够上下文理解写作意图
 * - 性能要求适中
 * - 用户期待高质量输出
 */
export const WRITING_CONTEXT: WritingContextConfig = {
  // === 中等范围配置 ===
  blocksBefore: 30,        // 🎯 获取前面30个块 (比批注的3多，比聊天的30少)
  blocksAfter: 16,          // 🎯 获取后面16个块 (适中)
  charsLimitBefore: 3000,  // 📝 前文限制3000字符 (适中)
  charsLimitAfter: 1000,    // 📝 后文限制1000字符 (适中)
  
  includeCurrentBlock: true,
  separateCurrentBlock: false, // 写作不需要单独分离当前块
};

/**
 * 🔄 转换为aiContextUtils兼容的选项格式
 */
export function toWritingContextOptions(config: WritingContextConfig): Record<string, any> {
  return {
    blocksBefore: config.blocksBefore,
    blocksAfter: config.blocksAfter,
    charsLimitBefore: config.charsLimitBefore,
    charsLimitAfter: config.charsLimitAfter,
    includeCurrentBlock: config.includeCurrentBlock,
    separateCurrentBlock: config.separateCurrentBlock
  };
}

/**
 * 获取编辑器写作上下文配置
 */
export function getWritingContextConfig(): WritingContextConfig {
  return WRITING_CONTEXT;
}

/**
 * 🎯 获取编辑器写作的结构化上下文（前后端协议）
 * 
 * 📍 关键：编辑器写作使用结构化上下文，类似批注但参数不同
 * 
 * 返回格式：
 * {
 *   context_before: string,
 *   context_after: string
 * }
 */
export async function getWritingStructuredContext(editor: any) {
  if (!editor) {
    return {
      context_before: null,
      context_after: null
    };
  }

  try {
    // 🎯 编辑器写作：使用结构化上下文函数
    const { getDefaultBlockContext } = await import('../../../../../shared/utils/aiContextUtils.js');
    const context = getDefaultBlockContext(editor, toWritingContextOptions(WRITING_CONTEXT));
    
    console.log('[WritingContext] 获取结构化上下文:', {
      前文字符数: context.contextBefore?.length || 0,
      后文字符数: context.contextAfter?.length || 0,
      使用配置: `前${WRITING_CONTEXT.blocksBefore}块+后${WRITING_CONTEXT.blocksAfter}块`,
      传递参数: 'context_before/after' // 🎯 结构化参数
    });
    
    // 🎯 返回编辑器写作专用的结构化格式
    return {
      context_before: context.contextBefore,
      context_after: context.contextAfter
    };
  } catch (error) {
    console.warn('[WritingContext] 获取结构化上下文失败:', error);
    return {
      context_before: null,
      context_after: null
    };
  }
} 