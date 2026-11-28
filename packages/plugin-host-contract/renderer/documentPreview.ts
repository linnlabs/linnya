import type { Component } from 'vue';
import type {
  DocumentPreviewImageRequest,
  DocumentPreviewRequest,
  DocumentPreviewResult,
} from '@app/schemas';
export declare function readDocumentPreview(
  input: DocumentPreviewRequest
): Promise<DocumentPreviewResult>;
export declare function listDocumentPreviewTypes(): Promise<
  readonly import('@app/schemas').DocumentPreviewType[]
>;

/** 调用方提供可信Renderer容器；项目和稳定身份由Host重新解析，组件必须只读。 */
export interface DocumentPreviewMountInput {
  readonly element: HTMLElement;
  readonly documentId: string;
  readonly projectId: string;
  readonly signal?: AbortSignal;
  readonly mode?: 'first-screen' | 'detail';
  readonly widthPx?: number;
  /** 正文呈现完成后通知消费方，可据此撤下位图。 */
  readonly onReady?: () => void;
}
/** 预览正文里一张图片的可显示地址（blob:），可直接用于 <img> 和画布出图；release 之前有效。 */
export interface DocumentPreviewImageHandle {
  readonly url: string;
  release(): void;
}
export interface RendererDocumentPreviewPort {
  mount(input: DocumentPreviewMountInput): Promise<() => void>;
  acquireImage(input: DocumentPreviewImageRequest): Promise<DocumentPreviewImageHandle>;
  /** 文档类型在侧栏里用的图标；未注册的类型由 Host 给通用文件图标。 */
  readTypeIcon?(nodeType: string): Component;
}
export declare function registerRendererDocumentPreviewPort(
  port: RendererDocumentPreviewPort
): void;
/** 预览卡片标出文档类型时用，与文件树同一图标；Host 未安装时返回 null，调用方自行兜底。 */
export declare function readDocumentPreviewTypeIcon(nodeType: string): Component | null;
export declare function mountDocumentPreview(input: DocumentPreviewMountInput): Promise<() => void>;
/**
 * 预览结果只带图片清单（尺寸），字节按显示尺寸另取：maxEdgePx 取不小于实际显示像素的最小一档。
 * 同一张图的同一档在 Host 的悬停预览、画布卡与详情之间共享；用完必须 release。
 * 文档不可读、图片不属于该文档时拒绝。
 */
export declare function acquireDocumentPreviewImage(
  input: DocumentPreviewImageRequest
): Promise<DocumentPreviewImageHandle>;
