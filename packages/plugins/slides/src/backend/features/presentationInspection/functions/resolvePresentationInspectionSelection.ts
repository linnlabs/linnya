import type {
  PresentationInspectionSelection,
  PresentationRenderModel,
} from '@plugin/slides/shared';

export interface ResolvedPresentationInspectionSelection {
  readonly renderModel: PresentationRenderModel;
  readonly requestedSlideNumbers: readonly number[];
  readonly truncated: boolean;
}

export function resolvePresentationInspectionSelection(
  renderModel: PresentationRenderModel,
  selection: PresentationInspectionSelection,
  maxSlides?: number,
): ResolvedPresentationInspectionSelection {
  if (maxSlides !== undefined && (!Number.isInteger(maxSlides) || maxSlides <= 0)) {
    throw new Error('Presentation inspection maxSlides must be a positive integer');
  }

  const requestedSlides = selectSlides(renderModel, selection);
  const selectedSlides = maxSlides === undefined
    ? requestedSlides
    : requestedSlides.slice(0, maxSlides);

  return {
    renderModel: {
      ...renderModel,
      slides: selectedSlides,
    },
    requestedSlideNumbers: requestedSlides.map((slide) => slide.index + 1),
    truncated: selectedSlides.length < requestedSlides.length,
  };
}

function selectSlides(
  renderModel: PresentationRenderModel,
  selection: PresentationInspectionSelection,
): PresentationRenderModel['slides'] {
  switch (selection.kind) {
    case 'all':
      return renderModel.slides;
    case 'single':
      return renderModel.slides.filter(
        (slide) => slide.index + 1 === selection.slideNumber,
      );
    case 'range':
      if (selection.toSlideNumber < selection.fromSlideNumber) {
        throw new Error('Presentation inspection range end cannot precede its start');
      }
      return renderModel.slides.filter(
        (slide) => slide.index + 1 >= selection.fromSlideNumber
          && slide.index + 1 <= selection.toSlideNumber,
      );
  }
}
