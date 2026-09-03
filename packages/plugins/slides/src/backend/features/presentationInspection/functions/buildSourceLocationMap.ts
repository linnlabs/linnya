import type { SourceLocationHint } from '@plugin/slides/shared';

export interface PresentationSourceStructure {
  readonly slides: readonly {
    readonly slideNumber: number;
    readonly startLine: number;
    readonly endLine: number;
  }[];
}

export function buildSourceLocationMap(
  structure: PresentationSourceStructure,
): ReadonlyMap<number, SourceLocationHint> {
  const locations = new Map<number, SourceLocationHint>();
  for (const slide of structure.slides) {
    locations.set(slide.slideNumber, {
      file: 'deck.js',
      slideNumber: slide.slideNumber,
      startLine: slide.startLine,
      endLine: slide.endLine,
    });
  }
  return locations;
}
