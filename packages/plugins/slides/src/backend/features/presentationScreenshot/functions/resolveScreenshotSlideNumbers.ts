import {
  SlidesScreenshotError,
  type PresentationScreenshotEncoding,
  type PresentationScreenshotSelection,
} from '../definitions/presentationScreenshot';

export function resolveScreenshotSlideNumbers(
  selection: PresentationScreenshotSelection,
  slideCount: number,
): number[] {
  if (!Number.isInteger(slideCount) || slideCount <= 0) {
    throw invalidRequest('Presentation must contain at least one slide');
  }

  switch (selection.kind) {
    case 'all':
      return Array.from({ length: slideCount }, (_, index) => index + 1);
    case 'single':
      assertSlideNumberInRange(selection.slideNumber, slideCount);
      return [selection.slideNumber];
    case 'range':
      assertSlideNumberInRange(selection.fromSlideNumber, slideCount);
      assertSlideNumberInRange(selection.toSlideNumber, slideCount);
      if (selection.fromSlideNumber > selection.toSlideNumber) {
        throw invalidRequest('Slide range start must not exceed its end');
      }
      return Array.from(
        { length: selection.toSlideNumber - selection.fromSlideNumber + 1 },
        (_, index) => selection.fromSlideNumber + index,
      );
  }
}

export function createScreenshotFileName(
  slideNumber: number,
  encoding: PresentationScreenshotEncoding,
): string {
  return `slide-${String(slideNumber).padStart(3, '0')}.${encoding.kind === 'lossless_png' ? 'png' : 'jpg'}`;
}

function assertSlideNumberInRange(slideNumber: number, slideCount: number): void {
  if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > slideCount) {
    throw new SlidesScreenshotError(
      'slides.screenshot.slide_out_of_range',
      `Slide number ${slideNumber} is outside 1-${slideCount}`,
      slideNumber,
    );
  }
}

function invalidRequest(message: string): SlidesScreenshotError {
  return new SlidesScreenshotError('slides.screenshot.invalid_request', message);
}
