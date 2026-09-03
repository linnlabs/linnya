import type {
  Box,
  DeckSpec,
  StructuredElement,
} from '@plugin/slides/shared';
import { resolveSlideSizeInches, type SlideSizeInches } from '@plugin/slides/shared';

const EPSILON = 0.001;

function formatBox(box: Box): string {
  return `x=${box.x}, y=${box.y}, w=${box.w}, h=${box.h}`;
}

function validateBoxWithinSlide(
  box: Box,
  slideSize: SlideSizeInches,
): string | null {
  if (box.w <= 0 || box.h <= 0) {
    return `box must have positive size, got ${formatBox(box)}`;
  }
  if (box.x < -EPSILON || box.y < -EPSILON) {
    return `box origin must be within slide bounds, got ${formatBox(box)}`;
  }
  if (box.x + box.w > slideSize.width + EPSILON || box.y + box.h > slideSize.height + EPSILON) {
    return `box exceeds slide bounds ${slideSize.width}x${slideSize.height} inches, got ${formatBox(box)}`;
  }
  return null;
}

function validateStructuredElement(
  element: StructuredElement,
  slideSize: SlideSizeInches,
): string | null {
  const boxError = validateBoxWithinSlide(element.position, slideSize);
  if (!boxError) {
    return null;
  }
  return `${element.type} element ${boxError}. Structured slide positions must use slide inches, not pixels or arbitrary coordinates.`;
}

export function assertDeckSpecGenerationValid(
  deckSpec: DeckSpec,
): void {
  const slideSize = resolveSlideSizeInches(deckSpec.layout);
  for (const slide of deckSpec.slides) {
    if (slide.spec.type !== 'structured') {
      continue;
    }
    for (const [elementIndex, element] of slide.spec.elements.entries()) {
      const error = validateStructuredElement(element, slideSize);
      if (error) {
        throw new Error(
          `Invalid structured slide geometry at slide ${slide.slideNumber}, element ${elementIndex + 1}: ${error}`,
        );
      }
    }
  }
}
