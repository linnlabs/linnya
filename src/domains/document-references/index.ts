export { createDocumentReferenceOperations } from './features/reference-index/orchestration/createDocumentReferenceOperations';
export { getDocumentReferenceSchemaProviders, DOCUMENT_REFERENCE_SCHEMAS } from './features/reference-index/persistence/referenceSchema';
export { DocumentReferenceError } from './definitions/documentReferences';
export type { ReferenceDatabase, ReferenceNodePort, ReferenceNode } from './definitions/documentReferences';
export { queryDocumentReferenceCandidates, readDocumentReferencePresentation } from './features/reference-query/functions/readDocumentReferencePresentation';
export type { ReferenceQueryPort } from './features/reference-query/definitions/referenceQuery';

export { createDocumentReferenceMarkdownRuntime } from './features/reference-markdown/orchestration/createDocumentReferenceMarkdownRuntime';
export { collectDocumentReferenceInputs } from './features/reference-markdown/functions/referenceContent';
export { ReferenceMarkdownError } from './features/reference-markdown/definitions/referenceMarkdown';
export type { ReferenceMarkdownPort, ReferenceMarkdownPrepared } from './features/reference-markdown/definitions/referenceMarkdown';

export { readDocumentDeletionReferences } from './features/deletion-preview/functions/readDocumentDeletionReferences';
