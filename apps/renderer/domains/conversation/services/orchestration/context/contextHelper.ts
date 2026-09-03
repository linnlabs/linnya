/**
 * @file apps/renderer/domains/conversation/services/orchestration/context/contextHelper.ts
 * @brief 侧边栏对话上下文构造编排
 */

import {
  getSidebarDocumentContextOptions,
} from './contextConfig.js';
import { useFileStore } from '../../../../../shared/stores/file.js';
import {
  getRendererPageContextProviderForContext,
  type RendererPageContextLike,
} from '@plugin/renderer/pageContextProvider';

/**
 * 页面上下文（最小依赖版本）
 *
 * 中文说明：
 * - 为避免 conversation 与具体插件强耦合，这里只定义最小字段
 * - 未来扩展时也应保持“最小必需字段”，避免把大对象塞进 contextHelper
 */
type PageContextLike = RendererPageContextLike;

/**
 * 🎯 获取侧边栏文档片段
 * 
 * 📍 关键区别：
 * - 侧边栏助手：传递 document_fragment (整体文档片段)
 * - 批注等功能：传递 context_before/after (结构化上下文)
 * 
 * 使用示例：
 * const { document_fragment } = await getSidebarDocumentContext(editor);
 */
export async function getSidebarDocumentContext(editor: unknown) {
  if (!editor) return { document_fragment: null };

  try {
    const options = getSidebarDocumentContextOptions();

    // 🎯 使用 aiContextUtils 提供的 DocumentView 能力，保持所有上下文逻辑集中在 aiContextUtils 中
    const { getViewportDocumentView } = await import(
      '../../../../../shared/utils/aiContextUtils.js'
    );

    // 获取当前文档 ID
    const fileStore = useFileStore();
    const currentDocumentId = fileStore.currentFilePath || 'sidebar-document';

    // 简单策略：使用侧边栏配置的字符上限之和作为 maxChars，保证不会发送整篇文档
    const maxChars =
      (options.charsLimitBefore ?? 0) + (options.charsLimitAfter ?? 0) || 4000;

    const viewResult = await getViewportDocumentView(editor, options, {
      // 传入真实的 documentId，以便上下文逻辑能正确关联
      documentId: currentDocumentId,
      maxChars
    });

    if (!viewResult) {
      console.warn('[ContextHelper] getViewportDocumentView 返回 null');
      return { document_fragment: null };
    }

    const finalFragment = viewResult.documentViewText || null;

    // 为日志创建一个摘要版本，避免在控制台打印过多内容
    let loggedContent = finalFragment;
    if (finalFragment && finalFragment.length > 250) {
      loggedContent = `${finalFragment.substring(0, 120)}... (内容已省略) ...${finalFragment.substring(
        finalFragment.length - 120
      )}`;
    }

    console.log(`[ContextHelper] 获取侧边栏文档片段(DocumentView):`, {
      片段字符数: finalFragment?.length || 0,
      使用配置: `blocksBefore=${options.blocksBefore}, blocksAfter=${options.blocksAfter}, maxChars=${maxChars}`,
      传递参数: 'document_fragment',
      文档片段内容: loggedContent
    });

    return {
      document_fragment: finalFragment
    };
  } catch (error) {
    console.warn('[ContextHelper] 获取文档片段失败:', error);
    return { document_fragment: null };
  }
}

/**
 * 🎯 获取侧边栏文档上下文（Editor / 插件页面统一入口）
 *
 * 中文说明：
 * - Editor：沿用 aiContextUtils.getViewportDocumentView → document_fragment
 * - 插件文档：由 page-context provider 把自身投影构建为 document_fragment
 * - Host 不理解插件内部快照结构，也不按文档类型分支
 */
export async function getSidebarDocumentFragmentContext(params: {
  editor: unknown;
  pageContext?: PageContextLike;
}): Promise<{ document_fragment: string | null }> {
  const { editor, pageContext } = params;

  // 1) Editor 分支：优先使用 editor 构建 DocumentView
  if (editor) {
    return getSidebarDocumentContext(editor);
  }

  // 2) 插件文档分支：无 editor 时，由对应插件 provider 构建 document_fragment
  if (pageContext) {
    const pluginPageContextProvider = getRendererPageContextProviderForContext(pageContext);
    if (pluginPageContextProvider?.buildDocumentFragment) {
      try {
        const fragment = await pluginPageContextProvider.buildDocumentFragment({
          pageContext,
          surface: 'sidebar',
        });

        if (fragment) {
          console.log('[ContextHelper] 获取插件文档片段:', {
            provider: pluginPageContextProvider.id,
            片段字符数: fragment.length,
            传递参数: 'document_fragment',
          });
        }

        return { document_fragment: fragment };
      } catch (error) {
        console.warn('[ContextHelper] 获取插件文档片段失败:', {
          provider: pluginPageContextProvider.id,
          error,
        });
        return { document_fragment: null };
      }
    }
  }

  // 3) 其他页面类型：暂无上下文
  return { document_fragment: null };
}
