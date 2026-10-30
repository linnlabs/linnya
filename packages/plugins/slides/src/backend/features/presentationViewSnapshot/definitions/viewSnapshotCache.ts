import type { PresentationRenderModel } from '@plugin/slides/shared/renderModel';
import type { ViewHeader, ViewManifest, ViewJsonRecord } from '@plugin/slides/shared/presentationViewSnapshot';

export interface CachedView {
  readonly nodeId: string;
  readonly header: ViewHeader;
  readonly manifest: ViewManifest;
  readonly blocks: readonly { hash: string; value: ViewJsonRecord; bytes: number; nodes: number }[];
  readonly bytes: number;
  readonly createdAt: number;
}
export interface CapturedView {
  readonly header: ViewHeader;
  readonly renderModel: PresentationRenderModel | null;
}
export const MAX_VIEW_CACHE_BYTES = 64 * 1024 * 1024;
