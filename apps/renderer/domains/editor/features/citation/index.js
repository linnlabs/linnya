/**
 * @file citation/index.js
 * @description Citation 功能模块统一导出入口
 *
 * Phase 1 导出：
 * - CitationNode: 正文引用原子节点
 * - BibliographyBlock: 参考文献容器块
 * - CitationFeatureExtension: 自动维护插件
 *
 * Phase 2 新增导出：
 * - useCitationPanelStore: 面板状态管理
 * - citationKbSearchService: KB 搜索服务
 * - knowledgeBaseCitationAdapter: KB 适配器
 * - webCitationAdapter: Web/Manual 适配器
 *
 * Phase 3 新增导出：
 * - CitationInteractionExtension: 交互扩展（渲染 + 事件）
 * - citationRenderPluginKey: 渲染插件 key
 * - citationUpdateService: 批量更新服务
 */

// ============ 扩展导出 ============

// 引用节点（inline atom）
export { CitationNode } from './nodes/CitationNode'

// 参考文献容器块（Node）
export { BibliographyBlock } from './blocks/BibliographyBlock'

// 自动维护扩展（Plugin）
export { CitationFeatureExtension, citationAutoMaintainPluginKey } from './extension/CitationFeatureExtension'

// Phase 3：交互扩展（渲染 + 事件监听）
export { CitationInteractionExtension, citationInteractionPluginKey } from './extension/CitationInteractionExtension'

// Phase 3：内联语法触发扩展（\\cite / [@ / [^）
export { CitationInlineTriggerExtension } from './extension/CitationInlineTriggerExtension'

// ============ Phase 2：Store 导出 ============

export { useCitationPanelStore } from './store/useCitationPanelStore'
export { useCitationClickPopover } from './ui/useCitationClickPopover'

// ============ Phase 2：Service 导出 ============

export { 
  searchInMultipleKbs,
  citationKbSearchService,
} from './services/citationKbSearchService'

// ============ Phase 2：Adapter 导出 ============

export { 
  convertKbResultToCitationAttrs,
  knowledgeBaseCitationAdapter,
} from './adapters/knowledgeBaseCitationAdapter'

export {
  convertWebManualFormToCitationAttrs,
  validateWebManualForm,
  webCitationAdapter,
} from './adapters/webCitationAdapter'

// ============ 工具函数导出（用于测试和调试）============

export {
  scanDocForCitations,
  computeBibliographyFixActions,
  needsBibliographyFix,
  createBibliographyBlockJSON,
  debugLog,
} from './plugins/bibliographyAutoMaintain'

// ============ Phase 3：渲染与更新服务导出 ============

export {
  createCitationRenderPlugin,
  citationRenderPluginKey,
  getCitationDerivation,
  getBibliographyEntries,
  getCurrentStyleId,
  getLabelBySourceId,
} from './render/citationRenderPlugin'

export {
  deriveCitations,
  scanCitationInstances,
  deduplicateToEntries,
  sortAndIndexEntries,
  getBibliographyStyleId,
} from './render/citationDerivation'

export {
  citationUpdateService,
  findCitationsBySourceId,
  countCitationsBySourceId,
  updateCitationsBySourceId,
  getCitationByCitationId,
} from './services/citationUpdateService'

// ============ 类型导出 ============

// 注意：类型导出使用 TypeScript 的 type-only 导出
// 但由于本文件是 .js，类型由 types.ts 单独提供
// 使用方应该直接从 './types' 导入类型
