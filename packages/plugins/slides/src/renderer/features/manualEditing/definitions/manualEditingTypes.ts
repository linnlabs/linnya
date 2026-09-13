import type {
  SlidesAuthoringEditRef,
  SlidesAuthoringObjectRef,
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
  /** 编译器投影的作者祖先，按外到内排列。 */
  readonly authoringAncestorRefs: readonly SlidesAuthoringObjectRef[];
  readonly bounds: RenderNodeSelectionRect;
  readonly polygon: readonly RenderNodeSelectionPoint[];
  /** 乐观预览必须共同平移的 RenderNode 根节点。 */
  readonly translationElementIds: readonly string[];
  readonly textEditing?: TextEditingTarget;
}

export type ManualEditableTargetPath = readonly ManualEditableTarget[];

export interface ManualEditingTranslationPreview {
  readonly elementId: string;
  readonly affectedElementIds: readonly string[];
  readonly dx: number;
  readonly dy: number;
}
