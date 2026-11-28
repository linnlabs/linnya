import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';

export interface PresentationPreviewState {
  readonly model: PresentationRenderModel | null;
  readonly bitmap: ImageBitmap | null;
  readonly pageIndex: number;
  readonly phase: 'loading' | 'ready' | 'failed' | 'empty';
}

/** Host 预览里已经显示的封面图；字段与通用预览结果的 image 一致。 */
export interface PresentationPreviewCover {
  readonly dataUri: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface PresentationPreviewPort {
  readonly read: () => Promise<PresentationRenderModel>;
  readonly render: (
    model: PresentationRenderModel,
    pageIndex: number,
    signal: AbortSignal
  ) => Promise<ImageBitmap>;
  readonly publish: (state: PresentationPreviewState) => void;
  readonly report: (error: unknown) => void;
}

export interface PresentationPreviewLabels {
  readonly readonly: string;
  readonly loading: string;
  readonly failed: string;
  readonly empty: string;
  readonly pages: string;
  readonly previous: string;
  readonly next: string;
}
