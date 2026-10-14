import type { SlideSizeInches } from '@plugin/slides/shared/deckSpec';

export interface SlideGridLayoutInput {
  /** 平铺滚动视口的可用宽度（CSS px，含左右留白）。 */
  readonly viewportWidth: number;
  readonly slideSize: SlideSizeInches | undefined;
  readonly slideCount: number;
}

export interface SlideGridLayout {
  readonly columns: number;
  readonly cellWidth: number;
  readonly thumbnailHeight: number;
  /** 虚拟列表行高：缩略图、页码行与行间距。 */
  readonly rowHeight: number;
  readonly rows: readonly (readonly number[])[];
  /** 向缩略图缓存请求的位图宽度，按档位取整以免窗口拖拽时反复重绘。 */
  readonly rasterWidth: number;
}

export type SlideNavigationKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End';

export type BlankSlideInsertionAvailability =
  | { readonly available: true; readonly index: number }
  | { readonly available: false; readonly reason: 'build_not_ready' | 'source_not_generated' | 'version_not_ready' };
