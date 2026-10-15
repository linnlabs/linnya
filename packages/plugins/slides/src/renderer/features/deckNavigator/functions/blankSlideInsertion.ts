import type { SlidesDocumentBuildState } from '@plugin/slides/shared/documentSource';
import type { PresentationRenderModel } from '../../../types/render';
import type { BlankSlideInsertionAvailability } from '../definitions/deckNavigatorTypes';

/**
 * 插入位置以用户当前看到的修订解释，所以要求可见 RenderModel 与 build state 是同一 revision。
 * 只有 generated deck.js 文稿拥有可改写的页面结构。
 */
export function resolveBlankSlideInsertion(input: {
  readonly documentId: string | null;
  readonly buildState: SlidesDocumentBuildState | null;
  readonly renderModel: PresentationRenderModel | null;
  readonly currentSlideIndex: number;
}): BlankSlideInsertionAvailability {
  const { buildState, renderModel } = input;
  if (!input.documentId || buildState?.state !== 'ready' || buildState.presentationId !== input.documentId) {
    return { available: false, reason: 'build_not_ready' };
  }
  if (renderModel?.presentationId !== input.documentId || renderModel.sourceKind !== 'generated') {
    return { available: false, reason: 'source_not_generated' };
  }
  if (renderModel.version !== buildState.versionNumber) {
    return { available: false, reason: 'version_not_ready' };
  }
  const slideCount = renderModel.slides.length;
  return { available: true, index: Math.min(Math.max(input.currentSlideIndex + 1, 0), slideCount) };
}
