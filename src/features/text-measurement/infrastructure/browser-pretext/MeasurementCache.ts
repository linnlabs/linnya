import type { NormalizedTextMeasureInput, TextMeasureResult } from '../../index.js';

const DEFAULT_MAX_ENTRIES = 1024;

function serializeParagraphs(input: NormalizedTextMeasureInput): Array<[
  string,
  number | undefined,
  number | undefined,
  number | undefined,
]> {
  return input.paragraphs.map((paragraph) => [
    paragraph.text,
    paragraph.indentInches,
    paragraph.spacingBeforePt,
    paragraph.spacingAfterPt,
  ]);
}

export function createMeasurementCacheKey(input: NormalizedTextMeasureInput): string {
  return JSON.stringify({
    p: serializeParagraphs(input),
    s: [
      input.style.fontSizePt,
      input.style.fontFamily,
      input.style.bold,
      input.style.italic,
      input.style.lineHeightMultiplier,
      input.style.letterSpacingPt,
    ],
    b: [
      input.box.widthInches,
      input.box.heightInches,
      input.box.wrap,
      input.box.padding.top,
      input.box.padding.right,
      input.box.padding.bottom,
      input.box.padding.left,
    ],
  });
}

export interface MeasurementCacheOptions {
  maxEntries?: number;
}

export class MeasurementCache {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, TextMeasureResult>();

  constructor(options: MeasurementCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(input: NormalizedTextMeasureInput): TextMeasureResult | undefined {
    const key = createMeasurementCacheKey(input);
    const cached = this.entries.get(key);
    if (cached == null) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, cached);
    return cached;
  }

  has(input: NormalizedTextMeasureInput): boolean {
    return this.entries.has(createMeasurementCacheKey(input));
  }

  set(input: NormalizedTextMeasureInput, result: TextMeasureResult): void {
    const key = createMeasurementCacheKey(input);
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, result);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey == null) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
