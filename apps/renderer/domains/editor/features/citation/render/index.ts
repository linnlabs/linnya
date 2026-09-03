/**
 * @file citation/render/index.ts
 * @description Phase 3 渲染模块导出
 */

// 派生模型
export {
  deriveCitations,
  scanCitationInstances,
  deduplicateToEntries,
  sortAndIndexEntries,
  generateLabelMaps,
  getBibliographyStyleId,
  type CitationInstance,
  type BibliographyEntry,
  type CitationDerivationResult,
} from './citationDerivation'

// 渲染插件
export {
  createCitationRenderPlugin,
  citationRenderPluginKey,
  getCitationDerivation,
  getBibliographyEntries,
  getCurrentStyleId,
  getLabelBySourceId,
  type CitationRenderPluginState,
} from './citationRenderPlugin'
