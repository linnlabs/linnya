/**
 * 编辑器模块统一导出
 * 提供编辑器相关的核心功能、服务和类型
 */

// --- 核心 ---
export * from './core/tokens'
export { getLowlight, resetLowlight } from './core/lowlight'
// @ts-ignore - JS 文件导入
export { createEditor } from './core/editorFactory.js'
export { getAllExtensions } from './core/extensionRegistry'
export type { ExtensionDependencies } from './core/extensionRegistry'

// --- 服务 ---
export { useStreamingHandlers } from './services/useStreamingHandlers.js'
export type { StreamingHandlers, StreamingState } from './services/useStreamingHandlers.js'

export { useAiWritingController } from './services/useAiWritingController.js'
export type { AiWritingControllerOptions, AiPromptData } from './services/useAiWritingController.js'

export { useMouseInteractions } from './services/useMouseInteractions.js'
export type { MouseInteractionsOptions } from './services/useMouseInteractions.js'

export { usePanelPositioning } from './services/usePanelPositioning.js'
export type { PanelPositioningOptions } from './services/usePanelPositioning.js'

export { bootstrapEditorServices } from './services/bootstrapEditorServices.js'
export type { EditorStores, BootstrapOptions } from './services/bootstrapEditorServices.js'

export { useEditorDocumentSettingsStore } from './features/DocumentSettings'

// @ts-ignore - JS 文件导入
export {
  loadContentIntoEditor,
  gatherSaveData,
} from './services/editorService.js'

// --- Markdown 双向转换 ---
export {
  importMarkdownToDocJson,
  type MarkdownImportResult,
  blockEventsToDocJson,
  type BlockEventLike,
} from './services/markdownConversion'

// --- UI 组件 ---
export { default as EditorContext } from './ui/EditorContext.vue'
export { default as EditorContent } from './ui/EditorContent.vue'
