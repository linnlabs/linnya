/**
 * @file apps/renderer/features/Annotation/config/contextConfig.ts
 * @brief 批注功能的上下文配置 - 有限上下文策略
 */

export interface AnnotationContextConfig {
  blocksBefore: number;
  blocksAfter: number;
  charsLimitBefore: number;
  charsLimitAfter: number;
  charsLimitCurrent: number;
  includeCurrentBlock: boolean;
  separateCurrentBlock: boolean;
}

/**
 * 🎯 批注回复的上下文配置
 * 
 * 💡 批注使用有限上下文策略：
 * - 局部问题，不需要全文理解
 * - 成本敏感，频繁调用
 * - 快速响应，用户期待即时反馈
 */
export const ANNOTATION_CONTEXT: AnnotationContextConfig = {
  // === 有限范围配置 ===
  blocksBefore: 3,         // 🔍 只获取前面3个块 (比侧边栏的30少很多)
  blocksAfter: 2,          // 🔍 只获取后面2个块 (比侧边栏的20少很多)
  charsLimitBefore: 1000,  // 📑 前文限制1000字符 (比侧边栏的4000少)
  charsLimitAfter: 500,    // 📑 后文限制500字符 (比侧边栏的1500少)
  charsLimitCurrent: 1500, // 📑 当前块限制1500字符
  
  includeCurrentBlock: true,
  separateCurrentBlock: true, // 批注需要单独获取当前块
};

/**
 * 🔄 转换为aiContextUtils兼容的选项格式
 */
export function toAnnotationContextOptions(config: AnnotationContextConfig): Record<string, any> {
  return {
    blocksBefore: config.blocksBefore,
    blocksAfter: config.blocksAfter,
    charsLimitBefore: config.charsLimitBefore,
    charsLimitAfter: config.charsLimitAfter,
    charsLimitCurrent: config.charsLimitCurrent,
    includeCurrentBlock: config.includeCurrentBlock,
    separateCurrentBlock: config.separateCurrentBlock
  };
}

/**
 * 获取批注上下文配置
 */
export function getAnnotationContextConfig(): AnnotationContextConfig {
  return ANNOTATION_CONTEXT;
}

/**
 * 🎯 获取批注的结构化上下文（前后端协议）
 * 
 * 📍 关键：批注使用结构化上下文，与侧边栏的document_fragment不同
 * 
 * 返回格式：
 * {
 *   context_before: string,
 *   context_after: string,
 *   current_block_content: string
 * }
 */
export async function getAnnotationStructuredContext(editor: any, blockId: string) {
  if (!editor || !blockId) {
    console.warn('[AnnotationContext] 参数无效:', { editor: !!editor, blockId });
    return {
      context_before: null,
      context_after: null,
      current_block_content: null
    };
  }

  console.log('[AnnotationContext] 开始获取上下文:', { blockId, editorValid: !!editor });

  try {
    // 🎯 批注：使用结构化上下文函数
    const { getAnnotationContext } = await import('../../../../../shared/utils/aiContextUtils.js');
    const config = toAnnotationContextOptions(ANNOTATION_CONTEXT);
    console.log('[AnnotationContext] 使用配置:', config);
    
    const context = getAnnotationContext(editor, blockId, config);
    console.log('[AnnotationContext] getAnnotationContext 返回:', context);
    
    if (!context) {
      console.warn('[AnnotationContext] getAnnotationContext 返回 null - 可能是找不到块或块为空');
      return {
        context_before: null,
        context_after: null,
        current_block_content: null
      };
    }
    
    console.log('[AnnotationContext] 获取结构化上下文:', {
      前文字符数: context.contextBefore?.length || 0,
      当前块字符数: context.currentBlockContent?.length || 0,
      后文字符数: context.contextAfter?.length || 0,
      传递参数: 'context_before/after + current_block_content' // 🎯 结构化参数
    });
    
    // 🎯 返回批注专用的结构化格式
    return {
      context_before: context.contextBefore,
      context_after: context.contextAfter,
      current_block_content: context.currentBlockContent
    };
  } catch (error) {
    console.warn('[AnnotationContext] 获取结构化上下文失败:', error);
    return {
      context_before: null,
      context_after: null,
      current_block_content: null
    };
  }
} 