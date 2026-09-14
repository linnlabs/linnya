import type {
  SlidesAuthoringEditCapability,
  SlidesAuthoringFillEditProjection,
  SlidesAuthoringEditRef,
  SlidesAuthoringObjectRef,
  SlidesManualTargetKind,
} from '@plugin/slides/shared/authoringEditing';
import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
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
  readonly capabilities: readonly SlidesAuthoringEditCapability[];
  readonly authoringRef: SlidesAuthoringEditRef;
  /** 编译器投影的作者祖先，按外到内排列。 */
  readonly authoringAncestorRefs: readonly SlidesAuthoringObjectRef[];
  readonly bounds: RenderNodeSelectionRect;
  readonly polygon: readonly RenderNodeSelectionPoint[];
  /** 乐观预览必须共同平移的 RenderNode 根节点。 */
  readonly translationElementIds: readonly string[];
  readonly textEditing?: TextEditingTarget;
  readonly fill?: SlidesAuthoringFillEditProjection;
  readonly visualSize?: {
    readonly width: number;
    readonly height: number;
  };
}

export type ManualEditableTargetPath = readonly ManualEditableTarget[];

export interface ManualEditingTranslationPreview {
  readonly elementId: string;
  readonly affectedElementIds: readonly string[];
  readonly dx: number;
  readonly dy: number;
}

export type ManualEditingVisualOperation = Extract<
  SlidesManualEditOperation,
  { readonly op: 'set_text_style' | 'set_fill_color' | 'set_visual_size' | 'delete_target' }
>;

export interface ManualEditingVisualPreview {
  readonly elementId: string;
  readonly affectedElementIds: readonly string[];
  readonly operation: ManualEditingVisualOperation;
}

/** Renderer 内部 intent；operation 是正式写入，preview 只服务提交队列的即时画面。 */
export interface ManualEditIntent {
  readonly operation: SlidesManualEditOperation;
  readonly translationPreview?: ManualEditingTranslationPreview;
  readonly visualPreview?: ManualEditingVisualPreview;
}
