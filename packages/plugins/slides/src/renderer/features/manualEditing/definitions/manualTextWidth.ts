import type { SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditIntent, ManualEditingVisualPreview } from './manualEditingTypes';

export type ManualTextWidthHandle = 'left' | 'right';
type WidthOperation = Extract<SlidesManualEditCommandOperation, { op: 'set_text_width' }>;
type TranslationOperation = Extract<SlidesManualEditCommandOperation, { op: 'translate_by' }>;

export interface ManualTextWidthResult {
  /** 左手柄把位移和宽度作为一次原子写入，保持右边缘不动。 */
  readonly operation: WidthOperation | { readonly op: 'batch'; readonly operations: readonly [TranslationOperation, WidthOperation] };
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface ManualTextWidthIntent extends ManualEditIntent {
  readonly visualPreviews: readonly [ManualEditingVisualPreview];
}
