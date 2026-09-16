import type { SlidesDocumentBuildState } from '@plugin/slides/shared/documentSource';
import type { PresentationRenderModel, SlideRenderModel } from '../../../types/render';
import { collectManualEditableTargets } from './manualEditableTargets';

export type ManualEditingUnavailableReason =
  | 'build_not_ready'
  | 'source_not_generated'
  | 'version_not_ready'
  | 'no_editable_targets';

export type ManualEditingAvailability =
  | { readonly available: true; readonly editableTargetCount: number }
  | {
      readonly available: false;
      readonly editableTargetCount: number;
      readonly reason: ManualEditingUnavailableReason;
    };

export function resolveManualEditingAvailability(input: {
  readonly buildState: SlidesDocumentBuildState | null;
  readonly renderModel: PresentationRenderModel | null;
  readonly currentSlide: SlideRenderModel | null;
}): ManualEditingAvailability {
  if (input.buildState?.state !== 'ready') {
    return { available: false, editableTargetCount: 0, reason: 'build_not_ready' };
  }
  if (input.renderModel?.sourceKind !== 'generated') {
    return { available: false, editableTargetCount: 0, reason: 'source_not_generated' };
  }
  if (input.renderModel.version !== input.buildState.versionNumber) {
    return { available: false, editableTargetCount: 0, reason: 'version_not_ready' };
  }
  const editableTargetCount = input.currentSlide
    ? collectManualEditableTargets(input.currentSlide.elements).length
    : 0;
  return editableTargetCount > 0
    ? { available: true, editableTargetCount }
    : { available: false, editableTargetCount: 0, reason: 'no_editable_targets' };
}
