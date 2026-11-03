import type { DocumentPreviewRequest, DocumentPreviewResult } from '@app/schemas';
export declare function readDocumentPreview(
  input: DocumentPreviewRequest
): Promise<DocumentPreviewResult>;
export declare function listDocumentPreviewTypes(): Promise<
  readonly import('@app/schemas').DocumentPreviewType[]
>;

/** 调用方提供可信Renderer容器；项目和稳定身份由Host重新解析，组件必须只读。 */
export interface DocumentPreviewDetailMountInput {
  readonly element: HTMLElement;
  readonly documentId: string;
  readonly projectId: string;
  readonly signal?: AbortSignal;
}
export interface RendererDocumentPreviewPort {
  mountDetail(input: DocumentPreviewDetailMountInput): Promise<() => void>;
}
export declare function registerRendererDocumentPreviewPort(
  port: RendererDocumentPreviewPort
): void;
export declare function mountDocumentPreviewDetail(
  input: DocumentPreviewDetailMountInput
): Promise<() => void>;
