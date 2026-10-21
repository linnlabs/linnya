export {
  writeMarkdownDocumentFromText,
  type MarkdownFileWriteEdit,
  type MarkdownFileWriteOperation,
  type MarkdownFileWriteResult,
  type MarkdownDocumentWriteStore,
} from './orchestration/writeMarkdownDocumentFromText';
export {
  admitMarkdownCitationHydration,
  admitMarkdownCitationLinkHydration,
  toCitationNodeHydrationData,
  type ResolveMarkdownCitationSources,
  type ResolveMarkdownCitationSourcesByUrl,
} from './functions/admitMarkdownCitationHydration';
export { buildMarkdownPendingCitationMetadata } from './orchestration/buildMarkdownPendingCitationMetadata';
export {
  buildMarkdownDocumentFromText,
  type MarkdownTextDocumentBuilder,
} from './orchestration/buildMarkdownDocumentFromText';

export { resolveMarkdownEscapeEquivalentText } from './functions/resolveMarkdownEscapeEquivalentText';
export { projectMarkdownFileWriteSnapshot } from './functions/projectMarkdownFileWriteSnapshot';
export { prepareMarkdownFileWrite, projectMarkdownFileEditText } from './orchestration/prepareMarkdownFileWrite';
export type { MarkdownFileWriteSnapshot } from './definitions/markdownFileWriteSnapshot';
export { MarkdownFileWriteConflictError } from './definitions/markdownDocumentWrite';
