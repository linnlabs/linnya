import type {
  DeckSpec,
  FreeformElement,
  StructuredElement,
} from '@plugin/slides/shared/deckSpec';

export function deckSpecHasSourceSpan(deckSpec: DeckSpec): boolean {
  return deckSpec.slides.some((entry) => (
    entry.spec.type === 'structured'
      ? structuredElementsHaveSourceSpan(entry.spec.elements)
      : freeformElementsHaveSourceSpan(entry.spec.elements)
  ));
}

function structuredElementsHaveSourceSpan(elements: readonly StructuredElement[]): boolean {
  return elements.some((element) => element._sourceSpan !== undefined);
}

function freeformElementsHaveSourceSpan(elements: readonly FreeformElement[]): boolean {
  return elements.some((element) => (
    element._sourceSpan !== undefined
    || (
      element.type === 'group'
      && element.children !== undefined
      && freeformElementsHaveSourceSpan(element.children)
    )
  ));
}
