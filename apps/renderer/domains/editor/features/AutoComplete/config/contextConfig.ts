/**
 * @file apps/renderer/domains/editor/features/AutoComplete/config/contextConfig.ts
 * @brief 自动补全功能的上下文配置
 */

import type { Editor } from '@tiptap/vue-3';
import type {
  AutocompleteContextConfig,
  AutocompleteStructuredContext
} from '../types';
import { AUTOCOMPLETE_CONFIG } from '../types';

// 重新导出类型，保持向后兼容
export type { AutocompleteContextConfig };

/**
 * 🎯 自动补全的上下文配置
 *
 * 💡 自动补全使用最小上下文策略：
 * - 快速响应，实时触发
 * - 成本敏感，高频调用
 * - 只需要少量上下文判断补全内容
 */
export const AUTOCOMPLETE_CONTEXT: AutocompleteContextConfig = {
  // === 最小范围配置 ===
  blocksBefore: AUTOCOMPLETE_CONFIG.context.blocksBefore,
  blocksAfter: AUTOCOMPLETE_CONFIG.context.blocksAfter,
  charsLimitBefore: AUTOCOMPLETE_CONFIG.context.charsLimitBefore,
  charsLimitAfter: AUTOCOMPLETE_CONFIG.context.charsLimitAfter,
};

/**
 * 🔄 转换为aiContextUtils兼容的选项格式
 */
export function toAutocompleteContextOptions(config: AutocompleteContextConfig): AutocompleteContextConfig {
  return {
    blocksBefore: config.blocksBefore,
    blocksAfter: config.blocksAfter,
    charsLimitBefore: config.charsLimitBefore,
    charsLimitAfter: config.charsLimitAfter
  };
}

/**
 * 获取自动补全上下文配置
 */
export function getAutocompleteContextConfig(): AutocompleteContextConfig {
  return AUTOCOMPLETE_CONTEXT;
}

/**
 * aiContextUtils 模块的上下文结果类型
 */
interface AiContextResult {
  /**
   * 光标前上下文（可能为空）
   * - 与 `apps/renderer/shared/utils/aiContextUtils.js#getAutocompleteContext` 返回保持一致
   */
  contextBefore: string | null;
  /**
   * 光标后上下文（可能为空）
   * - 与 `apps/renderer/shared/utils/aiContextUtils.js#getAutocompleteContext` 返回保持一致
   */
  contextAfter: string | null;
}

/**
 * 🎯 获取自动补全的结构化上下文（前后端协议）
 *
 * 📍 关键：自动补全使用结构化上下文，专门为光标位置优化
 *
 * @param editor - Tiptap 编辑器实例
 * @returns 结构化上下文对象
 */
export async function getAutocompleteStructuredContext(
  editor: Editor | null
): Promise<AutocompleteStructuredContext> {
  if (!editor) {
    return {
      context_before: null,
      context_after: null
    };
  }

  try {
    // 🎯 自动补全：使用专门的自动补全函数
    const { getAutocompleteContext } = await import('@/shared/utils/aiContextUtils.js');
    const context: AiContextResult = getAutocompleteContext(
      editor,
      toAutocompleteContextOptions(AUTOCOMPLETE_CONTEXT)
    );

    console.log('[AutocompleteContext] 获取结构化上下文:', {
      前文字符数: context.contextBefore?.length || 0,
      后文字符数: context.contextAfter?.length || 0,
      使用配置: `前${AUTOCOMPLETE_CONTEXT.blocksBefore}块+后${AUTOCOMPLETE_CONTEXT.blocksAfter}块`,
      传递参数: 'context_before/after' // 🎯 结构化参数
    });

    // 🎯 返回自动补全专用的结构化格式
    return {
      context_before: context.contextBefore ?? null,
      context_after: context.contextAfter ?? null
    };
  } catch (error) {
    console.warn('[AutocompleteContext] 获取结构化上下文失败:', error);
    return {
      context_before: null,
      context_after: null
    };
  }
}
