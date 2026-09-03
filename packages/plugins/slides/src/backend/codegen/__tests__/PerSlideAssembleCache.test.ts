import { describe, expect, it, vi } from 'vitest';

import type { DeckSpec } from '@plugin/slides/shared';
import {
  PerSlideAssembleCache,
  type PerSlideAssembleFallbackReason,
} from '../PerSlideAssembleCache.js';

function makeDeck(title: string, contents: string[]): DeckSpec {
  return {
    title,
    layout: '16x9',
    slides: contents.map((content, index) => ({
      slideNumber: index + 1,
      spec: {
        type: 'freeform',
        elements: [
          {
            type: 'text',
            position: { x: 0.5, y: 0.5, w: 4, h: 0.5 },
            content,
          },
        ],
      },
    })),
  };
}

describe('PerSlideAssembleCache', () => {
  it('computes stable per-slide hashes independent of deck title', () => {
    const cache = new PerSlideAssembleCache();
    const first = cache.buildSnapshot(makeDeck('First title', ['A', 'B']));
    const second = cache.buildSnapshot(makeDeck('Second title', ['A', 'B']));

    expect(first.slideHashes).toEqual(second.slideHashes);
  });

  it('detects changed, added, and removed slides by slideNumber and hash', () => {
    const cache = new PerSlideAssembleCache();
    const previous = cache.buildSnapshot(makeDeck('Previous', ['A', 'B', 'C']));
    const next = makeDeck('Next', ['A', 'B changed', 'D']);

    expect(cache.diffSlides(previous, next)).toEqual({
      changedSlideNumbers: [2, 3],
      addedSlideNumbers: [],
      removedSlideNumbers: [],
    });

    const removed = makeDeck('Removed', ['A']);
    expect(cache.diffSlides(previous, removed)).toEqual({
      changedSlideNumbers: [],
      addedSlideNumbers: [],
      removedSlideNumbers: [2, 3],
    });
  });

  it('uses full assemble when cache is disabled by default and records no fallback reason', async () => {
    const cache = new PerSlideAssembleCache();
    const assembleFull = vi.fn(async () => Buffer.from('full'));

    await expect(cache.assemble({
      deckSpec: makeDeck('Deck', ['A']),
      assembleFull,
    })).resolves.toEqual({
      buffer: Buffer.from('full'),
      telemetry: expect.objectContaining({
        strategy: 'full_assemble',
        enabled: false,
        changedSlideNumbers: [1],
        fallbackReason: undefined,
      }),
    });
    expect(assembleFull).toHaveBeenCalledTimes(1);
  });

  it.each<PerSlideAssembleFallbackReason>([
    'unsupported_slide_type',
    'automizer_merge_failed',
    'media_dedup_failed',
    'parse_equivalence_failed',
  ])('falls back to full assemble with reason %s when enabled merge reports fallback', async (reason) => {
    const cache = new PerSlideAssembleCache({
      enabled: true,
      mergeSlides: async () => ({ ok: false, reason }),
    });
    const assembleFull = vi.fn(async () => Buffer.from('full'));
    const previous = cache.buildSnapshot(makeDeck('Previous', ['A']));

    const result = await cache.assemble({
      deckSpec: makeDeck('Next', ['A changed']),
      previous,
      assembleFull,
    });

    expect(result.buffer).toEqual(Buffer.from('full'));
    expect(result.telemetry).toEqual(expect.objectContaining({
      strategy: 'full_assemble',
      enabled: true,
      changedSlideNumbers: [1],
      fallbackReason: reason,
    }));
    expect(assembleFull).toHaveBeenCalledTimes(1);
  });

  it('returns cached merge output only when enabled merge succeeds', async () => {
    const cache = new PerSlideAssembleCache({
      enabled: true,
      mergeSlides: async () => ({ ok: true, buffer: Buffer.from('merged') }),
    });
    const assembleFull = vi.fn(async () => Buffer.from('full'));
    const previous = cache.buildSnapshot(makeDeck('Previous', ['A']));

    const result = await cache.assemble({
      deckSpec: makeDeck('Next', ['A changed']),
      previous,
      assembleFull,
    });

    expect(result.buffer).toEqual(Buffer.from('merged'));
    expect(result.telemetry).toEqual(expect.objectContaining({
      strategy: 'per_slide_cache',
      enabled: true,
      changedSlideNumbers: [1],
      fallbackReason: undefined,
    }));
    expect(assembleFull).not.toHaveBeenCalled();
  });
});
