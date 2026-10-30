import type { Ref } from 'vue';
import type { SlideRenderModel } from '../../types/render';
import type { ManualEditableTarget } from '../../features/manualEditing/selection';
import type { SourceSelectableElement, SourceSelectionEditSubmitPayload } from '../../features/sourceSelection';

export interface StageAiPrompt {
  readonly manualSelectedTargets: Ref<readonly ManualEditableTarget[]>;
  readonly displayedSlide: Ref<SlideRenderModel | null>;
  readonly selectedSourceTargets: Ref<readonly SourceSelectableElement[]>;
  readonly canSelectSourceElements: Ref<boolean>;
  readonly stageOverlayGeometryRevision: Ref<number>;
  readonly canvasShellRef: Ref<HTMLElement | null>;
  readonly renderScale: Ref<number>;
  readonly actualSlideSize: Ref<{ width: number; height: number }>;
  readonly preparingSlideVisuals: Ref<boolean>;
  readonly activeSlideId: Ref<string | null>;
  finishText(): void;
  clearSourceSelection(): void;
  focusCanvas(): void;
  submit(payload: SourceSelectionEditSubmitPayload): void;
}
