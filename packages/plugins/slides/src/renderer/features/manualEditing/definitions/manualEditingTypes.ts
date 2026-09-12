import type {
  SlidesAuthoringEditRef,
  SlidesManualTargetKind,
} from '@plugin/slides/shared/authoringEditing';
import type { RenderNodeKind } from '../../../types/render';
import type {
  SourceSelectionPoint,
  SourceSelectionRect,
} from '../../sourceSelection';

export interface ManualEditableTarget {
  readonly elementId: string;
  readonly nodeKind: RenderNodeKind;
  readonly targetKind: SlidesManualTargetKind;
  readonly authoringRef: SlidesAuthoringEditRef;
  readonly bounds: SourceSelectionRect;
  readonly polygon: readonly SourceSelectionPoint[];
  readonly textContent?: string;
}

export interface ManualEditingTranslationPreview {
  readonly elementId: string;
  readonly dx: number;
  readonly dy: number;
}
