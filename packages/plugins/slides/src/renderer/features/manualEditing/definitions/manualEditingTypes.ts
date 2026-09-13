import type {
  SlidesAuthoringEditRef,
  SlidesManualTargetKind,
} from '@plugin/slides/shared/authoringEditing';
import type { RenderNodeKind } from '../../../types/render';
import type {
  RenderNodeSelectionPoint,
  RenderNodeSelectionRect,
} from '../../renderNodeSelection';
import type { TextEditingTarget } from '../../textEditing';

export interface ManualEditableTarget {
  readonly elementId: string;
  readonly nodeKind: RenderNodeKind;
  readonly targetKind: SlidesManualTargetKind;
  readonly authoringRef: SlidesAuthoringEditRef;
  readonly bounds: RenderNodeSelectionRect;
  readonly polygon: readonly RenderNodeSelectionPoint[];
  /** 乐观预览必须共同平移的 RenderNode 根节点。 */
  readonly translationElementIds: readonly string[];
  readonly textEditing?: TextEditingTarget;
}

export interface ManualEditingTranslationPreview {
  readonly elementId: string;
  readonly affectedElementIds: readonly string[];
  readonly dx: number;
  readonly dy: number;
}
