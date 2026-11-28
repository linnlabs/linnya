import type { Component } from 'vue';
import type {
  DocumentPreviewImageSource,
  DocumentPreviewImageTier,
  DocumentPreviewResult,
} from '@app/schemas';

/**
 * 正文图片的取法。预览结果只带图片清单，字节由消费方提供可显示地址（<img> 可用；出图要求 blob: 或 data:）。
 * 表面按图片排出的尺寸乘 scale 选档，释放表面时归还取到的每一张。
 */
export interface DocumentPreviewSurfaceImages {
  /** 输出像素与 CSS 像素之比：屏幕倍率；画布出图再乘出图缩放。 */
  readonly scale: number;
  /** 只对全文有意义：首个窗口高度以下的图片等接近可见范围再取；出图等需要一次画全的消费方不设。 */
  readonly lazy?: boolean;
  acquire(request: {
    readonly source: DocumentPreviewImageSource;
    readonly maxEdgePx: DocumentPreviewImageTier;
    readonly signal: AbortSignal;
  }): Promise<{ readonly url: string; release(): void }>;
}

export interface DocumentPreviewSurfaceInput {
  readonly preview: DocumentPreviewResult;
  readonly document: Document;
  /** 容器的逻辑宽度，不含相机缩放或 DPR。 */
  readonly widthPx: number;
  readonly maxHeight?: number;
  /**
   * 内容不足 maxHeight 时表面按内容高度收短（悬停浮层）；缺省表面固定为 maxHeight（画布卡面按卡高铺满）。
   * 只在传了 maxHeight 时有意义。
   */
  readonly fitContentHeight?: boolean;
  /** 容器比可见范围大时（Canvas 纸面内缩）四周内缩的距离，首屏正文和淡出在可见边缘结束。 */
  readonly visibleInsetPx?: number;
  readonly theme: 'light' | 'dark';
  /** 界面语言（如 zh-CN、en-US），决定外壳文字和正文里引用、参考文献等的语言；缺省 zh-CN，后台出图等不知道界面语言时省略。 */
  readonly locale?: string;
  readonly signal: AbortSignal;
  readonly icon?: Component | null;
  /** 正文里行内引用的类型图标，与文件树同源；后台出图等拿不到时省略，引用用通用文件图标。 */
  readonly referenceTypeIcon?: (nodeType: string) => Component | null;
  /** 正文里有图片而没有提供时，表面构建明确失败。 */
  readonly images?: DocumentPreviewSurfaceImages;
  readonly onOpen?: () => void;
  /** 类型自己贡献交互详情时，只复用外壳和标题；有封面图时先放着占位，详情挂进正文容器后自动让位。 */
  readonly externalBody?: boolean;
}
export interface DocumentPreviewSurface {
  readonly element: HTMLElement;
  readonly body: HTMLElement;
  dispose(): void;
}
/** 卡壳和正文范围的计算与 CSS 同源，所有消费方只提供总宽高。 */
export const DOCUMENT_PREVIEW_LAYOUT = {
  paddingInline: 18,
  paddingTop: 12,
  paddingBottom: 18,
  titleHeight: 16,
  titleGap: 10,
  firstScreenHeight: 380,
} as const;
