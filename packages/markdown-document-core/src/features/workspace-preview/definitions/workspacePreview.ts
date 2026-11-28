import type { DocumentPreviewImageSource, WorkspaceMarkdownPreview } from '@app/schemas';

/** 一张图片的可显示地址；release 之前有效。 */
export interface WorkspacePreviewImageHandle {
  readonly url: string;
  release(): void;
}
export interface WorkspacePreviewImageRequest {
  readonly source: DocumentPreviewImageSource;
  /** 图片在正文里排出的宽高（CSS px，不含外层缩放）；加载方按自己的输出倍率选档。 */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly signal: AbortSignal;
}
export interface WorkspaceMarkdownPreviewInput {
  readonly content: WorkspaceMarkdownPreview;
  readonly document: Document;
  readonly widthPx: number;
  readonly theme: 'light' | 'dark';
  readonly signal: AbortSignal;
  readonly maxHeight?: number;
  readonly locale?: string;
  /** 行内引用图标由呈现宿主按文档类型提供（失效目标传 null）；portable core 不带图标资源。缺省时只显示标题。 */
  readonly referenceIcon?: (nodeType: string | null) => Node;
  /** 预览内容只带图片清单，字节由呈现宿主按排出的尺寸提供。正文里有图片而没有提供时明确失败。 */
  readonly loadImage?: (request: WorkspacePreviewImageRequest) => Promise<WorkspacePreviewImageHandle>;
  /**
   * 只对全文（未传 maxHeight）有意义：这个高度以下的图片先按清单尺寸占位，接近可见范围再加载。
   * 缺省时全部图片加载完才交付，供出图等需要一次画全的消费方使用。
   */
  readonly lazyImagesBelowPx?: number;
}
export interface WorkspaceMarkdownPreviewSurface {
  readonly element: HTMLElement;
  dispose(): void;
}
