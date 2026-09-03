import { createHash } from 'node:crypto';

import type { DeckSpec } from '@plugin/slides/shared';

export type PerSlideAssembleFallbackReason =
  | 'unsupported_slide_type'
  | 'automizer_merge_failed'
  | 'media_dedup_failed'
  | 'parse_equivalence_failed';

export interface SlideHashEntry {
  slideNumber: number;
  hash: string;
}

export interface PerSlideAssembleSnapshot {
  slideHashes: SlideHashEntry[];
  pptxBuffer?: Buffer;
}

export interface PerSlideDiffResult {
  changedSlideNumbers: number[];
  addedSlideNumbers: number[];
  removedSlideNumbers: number[];
}

export interface PerSlideAssembleTelemetry extends PerSlideDiffResult {
  enabled: boolean;
  strategy: 'full_assemble' | 'per_slide_cache';
  fallbackReason?: PerSlideAssembleFallbackReason;
  slideHashes: SlideHashEntry[];
}

export interface PerSlideAssembleInput {
  deckSpec: DeckSpec;
  previous?: PerSlideAssembleSnapshot;
  assembleFull: () => Promise<Buffer>;
}

export interface PerSlideAssembleResult {
  buffer: Buffer;
  telemetry: PerSlideAssembleTelemetry;
}

export type PerSlideMergeResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: PerSlideAssembleFallbackReason };

export interface PerSlideMergeInput extends PerSlideDiffResult {
  deckSpec: DeckSpec;
  previous: PerSlideAssembleSnapshot;
  next: PerSlideAssembleSnapshot;
}

export interface PerSlideAssembleCacheOptions {
  enabled?: boolean;
  mergeSlides?: (input: PerSlideMergeInput) => Promise<PerSlideMergeResult>;
}

export class PerSlideAssembleCache {
  private readonly enabled: boolean;
  private readonly mergeSlides?: (input: PerSlideMergeInput) => Promise<PerSlideMergeResult>;

  constructor(options: PerSlideAssembleCacheOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.mergeSlides = options.mergeSlides;
  }

  buildSnapshot(deckSpec: DeckSpec, pptxBuffer?: Buffer): PerSlideAssembleSnapshot {
    return {
      slideHashes: deckSpec.slides.map((entry) => ({
        slideNumber: entry.slideNumber,
        hash: hashStableJson(entry),
      })),
      ...(pptxBuffer ? { pptxBuffer } : {}),
    };
  }

  diffSlides(previous: PerSlideAssembleSnapshot, nextDeckSpec: DeckSpec): PerSlideDiffResult {
    return diffSlideHashes(previous.slideHashes, this.buildSnapshot(nextDeckSpec).slideHashes);
  }

  async assemble(input: PerSlideAssembleInput): Promise<PerSlideAssembleResult> {
    const next = this.buildSnapshot(input.deckSpec);
    const diff = input.previous
      ? diffSlideHashes(input.previous.slideHashes, next.slideHashes)
      : allSlidesChanged(next.slideHashes);

    if (!this.enabled || !input.previous || !this.mergeSlides) {
      return this.fullAssemble(input.assembleFull, next.slideHashes, diff);
    }

    const mergeResult = await this.mergeSlides({
      deckSpec: input.deckSpec,
      previous: input.previous,
      next,
      ...diff,
    });
    if (!mergeResult.ok) {
      return this.fullAssemble(input.assembleFull, next.slideHashes, diff, mergeResult.reason);
    }

    return {
      buffer: mergeResult.buffer,
      telemetry: {
        enabled: true,
        strategy: 'per_slide_cache',
        fallbackReason: undefined,
        slideHashes: next.slideHashes,
        ...diff,
      },
    };
  }

  private async fullAssemble(
    assembleFull: () => Promise<Buffer>,
    slideHashes: SlideHashEntry[],
    diff: PerSlideDiffResult,
    fallbackReason?: PerSlideAssembleFallbackReason,
  ): Promise<PerSlideAssembleResult> {
    return {
      buffer: await assembleFull(),
      telemetry: {
        enabled: this.enabled,
        strategy: 'full_assemble',
        fallbackReason,
        slideHashes,
        ...diff,
      },
    };
  }
}

function diffSlideHashes(previous: SlideHashEntry[], next: SlideHashEntry[]): PerSlideDiffResult {
  const previousBySlide = new Map(previous.map(entry => [entry.slideNumber, entry.hash]));
  const nextBySlide = new Map(next.map(entry => [entry.slideNumber, entry.hash]));
  const changedSlideNumbers: number[] = [];
  const addedSlideNumbers: number[] = [];
  const removedSlideNumbers: number[] = [];

  for (const entry of next) {
    const previousHash = previousBySlide.get(entry.slideNumber);
    if (!previousHash) {
      addedSlideNumbers.push(entry.slideNumber);
    } else if (previousHash !== entry.hash) {
      changedSlideNumbers.push(entry.slideNumber);
    }
  }

  for (const entry of previous) {
    if (!nextBySlide.has(entry.slideNumber)) {
      removedSlideNumbers.push(entry.slideNumber);
    }
  }

  return {
    changedSlideNumbers,
    addedSlideNumbers,
    removedSlideNumbers,
  };
}

function allSlidesChanged(slideHashes: SlideHashEntry[]): PerSlideDiffResult {
  return {
    changedSlideNumbers: slideHashes.map(entry => entry.slideNumber),
    addedSlideNumbers: [],
    removedSlideNumbers: [],
  };
}

function hashStableJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(entry => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}
