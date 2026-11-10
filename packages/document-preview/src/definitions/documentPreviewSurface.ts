import type { Component } from 'vue';
import type { DocumentPreviewResult } from '@app/schemas';

export interface DocumentPreviewSurfaceInput {
  readonly preview: DocumentPreviewResult;
  readonly document: Document;
  /** 容器的逻辑宽度，不含相机缩放或 DPR。 */
  readonly widthPx: number;
  readonly maxHeight?: number;
  /** 容器比可见范围大时（Canvas 纸面内缩）四周内缩的距离，首屏正文和淡出在可见边缘结束。 */
  readonly visibleInsetPx?: number;
  readonly theme: 'light' | 'dark';
  readonly signal: AbortSignal;
  readonly icon?: Component | null;
  readonly onOpen?: () => void;
  /** 类型自己贡献交互详情时，只复用外壳和标题，不在下方再画一张封面。 */
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
  firstScreenHeight: 320,
} as const;
