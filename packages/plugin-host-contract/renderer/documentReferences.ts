import type { DocumentBacklinksRequest, DocumentBacklinksPage, DocumentReferenceCandidate, DocumentReferenceDeletionPreview, DocumentReferencePresentation } from '@app/schemas';

/** 同项目活动文档的只读候选。路径/标题只是当前展示，选择后持久化 documentId。 */
export declare function queryDocumentReferences(input: { readonly projectId: string; readonly keyword: string; readonly limit?: number }): Promise<readonly DocumentReferenceCandidate[]>;
export declare function readDocumentReference(input: { readonly projectId: string; readonly documentId: string }): Promise<DocumentReferencePresentation>;

export declare function previewDocumentDeletionReferences(input: { readonly nodeIds: readonly string[] }): Promise<DocumentReferenceDeletionPreview>;

export declare function readDocumentBacklinks(input: DocumentBacklinksRequest): Promise<DocumentBacklinksPage>;
