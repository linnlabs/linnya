export {
  MarkdownDocumentService,
} from './infrastructure/sqlite/markdownDocumentService';
export { MarkdownDocumentVersionReader } from './infrastructure/sqlite/markdownDocumentVersionReader';
export type { MarkdownAnnotation as Annotation } from '../annotations';
export type { MarkdownDocumentVersion as DocumentVersion } from './definitions/documentVersion';
export { countMarkdownTextUnits } from './functions/countMarkdownTextUnits';
export {
  MarkdownOrphanBlockDataCleaner,
  type OrphanCleanupResult,
} from './infrastructure/sqlite/markdownOrphanBlockDataCleaner';
