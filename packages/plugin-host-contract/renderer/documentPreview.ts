import type { DocumentPreviewRequest, DocumentPreviewResult } from '@app/schemas';
export declare function readDocumentPreview(input: DocumentPreviewRequest): Promise<DocumentPreviewResult>;
export declare function listDocumentPreviewTypes(): Promise<readonly import('@app/schemas').DocumentPreviewType[]>;
