import type { Component } from 'vue';
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
  /** 文档类型在侧栏里用的图标；未注册的类型由 Host 给通用文件图标。 */
  readTypeIcon?(nodeType: string): Component;
}
export declare function registerRendererDocumentPreviewPort(
  port: RendererDocumentPreviewPort
): void;
/** 预览卡片标出文档类型时用，与文件树同一图标；Host 未安装时返回 null，调用方自行兜底。 */
export declare function readDocumentPreviewTypeIcon(nodeType: string): Component | null;
export declare function mountDocumentPreviewDetail(
  input: DocumentPreviewDetailMountInput
): Promise<() => void>;
