import type { DeckSpec, FreeformElement } from '@plugin/slides/shared';
import { SlideMarkerIndex } from '@plugin/slides/shared';
import type { PptStructureOutput } from './CodegenPresentationTypes.js';
import { normalizeLineEndings, splitLines } from './sourceText.js';

export function structureDeckSource(
  presentationId: string,
  versionId: string,
  title: string,
  source: string,
  deckSpec: DeckSpec,
  options: { elementCountsUnavailable?: boolean } = {},
): PptStructureOutput {
  const normalizedSource = normalizeLineEndings(source);
  const markerIndex = SlideMarkerIndex.build(normalizedSource);
  const ranges = markerIndex.listSlides();
  const lines = splitLines(normalizedSource);

  return {
    presentationId,
    title,
    versionId,
    totalLines: lines.length,
    slideCount: ranges.length,
    slides: ranges.map((range, index) => {
      const slideSpec = deckSpec.slides[index]?.spec;
      const titleGuess = guessTitleFromSource(markerIndex.sliceRange(range.startLine, range.endLine));
      return {
        slideNumber: range.slideNumber,
        startLine: range.startLine,
        endLine: range.endLine,
        ...(titleGuess ? { titleGuess } : {}),
        elementCounts: options.elementCountsUnavailable || !slideSpec ? {} : countElements(slideSpec.elements),
        ...(options.elementCountsUnavailable ? { elementCountsUnavailable: true } : {}),
      };
    }),
  };
}

function guessTitleFromSource(source: string): string | undefined {
  const match = /createText\s*\(\s*\{[^}]*content\s*:\s*["'`]([^"'`]+)["'`]/s.exec(source);
  return match?.[1];
}

function countElements(elements: ReadonlyArray<{ type: string; children?: FreeformElement[] }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const element of elements) {
    counts[element.type] = (counts[element.type] ?? 0) + 1;
    if (element.type === 'group' && element.children) {
      const childCounts = countElements(element.children);
      for (const [key, value] of Object.entries(childCounts)) {
        counts[key] = (counts[key] ?? 0) + value;
      }
    }
  }
  return counts;
}
