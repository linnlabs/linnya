import type { SlidesAuthoringEditRef } from '@plugin/slides/shared';

/** 撤销后与重做后各自要呈现的页；页序动作在前后两份文稿中位置不同。 */
export interface ManualEditHistoryFocus {
  readonly beforeSlideIndex: number;
  readonly afterSlideIndex: number;
  readonly targets: readonly SlidesAuthoringEditRef[];
}
export interface ManualEditHistoryEntry {
  readonly before: string;
  readonly after: string;
  readonly focus?: ManualEditHistoryFocus;
}
export interface ManualEditHistoryState {
  readonly currentRevisionId: string;
  readonly undo: readonly ManualEditHistoryEntry[];
  readonly redo: readonly ManualEditHistoryEntry[];
}
export const MANUAL_EDIT_HISTORY_LIMIT = 50;
