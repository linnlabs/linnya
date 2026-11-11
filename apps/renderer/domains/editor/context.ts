/** Markdown 编辑器上下文的窄公开合同，不装配 Editor UI 或模型调用。 */
export {
  getContextAroundSelection,
  getBlockContextByCounts,
  getDefaultBlockContext,
  getAnnotationContext,
  getViewportContext,
  getViewportDocumentView,
  getAutocompleteContext,
} from './shared/context/documentContext.js';
export {
  serializeDocumentViewFromEditor,
  flattenBlocksFromEditor,
  buildBodyFromBlocks,
  buildDocumentView,
} from './shared/context/documentViewSerializer';
export type {
  FlattenedBlock,
  SerializeDocumentViewOptions,
  SerializeDocumentViewResult,
  DocumentViewDocType,
  DocumentViewMeta,
} from './shared/context/documentViewSerializer';
