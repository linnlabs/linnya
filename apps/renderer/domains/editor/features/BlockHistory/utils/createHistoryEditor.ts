
import type { EditorOptions } from '@tiptap/core'
import { historyExtensions } from './historyExtensions'

/**
 * 创建历史版本展示专用 Editor 的基础配置
 *
 * 注意：
 * - 真正的 Editor 实例由 `useEditor` 在组件内创建并托管生命周期
 * - 这里仅返回一个干净的配置对象，方便在多个地方复用
 */
export function createHistoryEditorOptions(
  initialContent?: unknown,
): Pick<EditorOptions, 'extensions' | 'editable' | 'content' | 'editorProps'> {
  return {
    // 复用主编辑器的大部分 Schema / 扩展（通过 historyExtensions 精简）
    extensions: historyExtensions,
    // 历史面板仅用于展示，不允许编辑
    editable: false,
    // 默认内容为空，由外部通过 setContent 控制
    content: initialContent ?? null,
    editorProps: {
      attributes: {
        // 为历史编辑器根节点增加一个 class，方便定制样式
        class: 'history-editor-content',
      },
    },
  }
}

