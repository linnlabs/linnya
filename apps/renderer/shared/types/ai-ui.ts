import type { Editor as TiptapEditor } from '@tiptap/core'

/**
 * 批注面板布局管理器（由 editorFactory onCreate 挂到 editor.panelPositionManager）
 */
export interface AnnotationPanelPositionManager {
  recalculateAllPositions: (resetToIdeal?: boolean) => Promise<void> | void
}

/**
 * editorFactory 等在运行期挂到 Tiptap Editor 上的字段（非 @tiptap/core 类型声明的一部分）
 */
export interface EditorInstanceRuntimeExtensions {
  panelPositionManager?: AnnotationPanelPositionManager
  /** useAnnotationStore 实例，与 panelPositionManager 同源挂载 */
  annotationStore?: unknown
}

export interface AiPromptPosition {
  top: number
  left?: number
  width?: number | string
}

export type AiPromptTriggerPos = number | null

export type UiEditorInstance = (TiptapEditor & EditorInstanceRuntimeExtensions) | null
