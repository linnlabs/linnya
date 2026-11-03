import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';

export interface PresentationPreviewState {
  readonly model: PresentationRenderModel | null;
  readonly bitmap: ImageBitmap | null;
  readonly pageIndex: number;
  readonly phase: 'loading' | 'ready' | 'failed' | 'empty';
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
