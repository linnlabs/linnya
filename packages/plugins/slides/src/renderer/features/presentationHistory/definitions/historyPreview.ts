import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';

export interface HistoryPreviewState {
  readonly model: PresentationRenderModel | null;
  readonly bitmap: ImageBitmap | null;
  readonly pageIndex: number;
  readonly phase: 'loading' | 'ready' | 'failed' | 'empty';
}

export interface HistoryPreviewPort {
  readonly read: () => Promise<PresentationRenderModel>;
  readonly render: (
    model: PresentationRenderModel,
    pageIndex: number,
    signal: AbortSignal
  ) => Promise<ImageBitmap>;
  readonly publish: (state: HistoryPreviewState) => void;
  readonly report: (error: unknown) => void;
}
