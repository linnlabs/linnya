export { bindMarkdownDocumentReferences, getMarkdownDocumentReferences } from './registry/markdownDocumentReferencesRegistry';
export { projectMarkdownReferencePendings, buildMarkdownReferenceReadProjection, assertMarkdownDocumentReferenceIdentities, collectMarkdownDocumentReferences, readPendingDocumentReferenceBindings, pendingDocumentReferenceBindings, referenceBaselineContent, projectMarkdownReferenceContent, hydratePendingDocumentReferences } from './functions/markdownReferenceContent';
export type { MarkdownDocumentReferencesPort, MarkdownReferenceReadBaseline } from './definitions/markdownDocumentReferences';

export { prepareRemainingReferenceRevision } from './functions/prepareRemainingReferenceRevision';
