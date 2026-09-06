/**
 * @file test-support.ts
 * @description Mindmap 插件测试专用入口。
 *
 * 中文说明：这里暴露迁移、schema 与持久化 service fixture，供 host/plugin 契约测试使用。
 * 生产侧只能从 `@plugin/mindmap/backend` 取得插件 contribution 与稳定注册契约，
 * 禁止把这些内部实现重新挂回 public backend entry。
 */

export { mindmapPluginMigrations } from './persistence/migrations';
export { MINDMAP_DOCUMENT_SCHEMAS } from './persistence/mindmap_document/schemas/core.schema';
export {
  MindMapDocumentService,
  type CreateMindMapParams,
  type UpdateMindMapParams,
  type MindMapData,
} from './persistence/mindmap_document/services/mindmap_document.service';
export {
  buildMindMapNodeRefView,
  buildMindMapObservation,
  type MindMapNodeRefViewResult,
  type MindMapUiLimits,
} from './tools/mindmap/read/mindmapNodeRefViewBuilder';
export { registerMindMapDocumentHandlers } from './ipc/mindmap_document/document-ipc';
export {
  mindmapToolClasses,
  mindmapToolManifest,
  mindmapToolNames,
  type MindmapBackendToolClass,
} from './tools/mindmap/toolManifest';
