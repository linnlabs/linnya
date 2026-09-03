export interface SlidesReferenceSlideInput {
  readonly slideId: string;
}

export interface SlidesReferenceDeckInput {
  readonly documentId: string;
  readonly slides: readonly SlidesReferenceSlideInput[];
}

export type SlidesReferenceFocusTarget =
  | { readonly kind: 'deck' }
  | { readonly kind: 'slide'; readonly slideIndex: number };

export function listSlidesReferenceIds(input: SlidesReferenceDeckInput): readonly string[] {
  return [
    input.documentId,
    ...input.slides.map((slide) => slide.slideId),
  ];
}

export function resolveSlidesReferenceFocusTarget(input: {
  readonly documentId: string;
  readonly referenceId: string;
  readonly slides: readonly SlidesReferenceSlideInput[];
}): SlidesReferenceFocusTarget | null {
  if (input.referenceId === input.documentId) {
    return { kind: 'deck' };
  }

  const slideIndex = input.slides.findIndex((slide) => slide.slideId === input.referenceId);
  return slideIndex >= 0
    ? { kind: 'slide', slideIndex }
    : null;
}
