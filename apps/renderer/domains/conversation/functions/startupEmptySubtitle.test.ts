import { describe, expect, it } from 'vitest';
import {
  STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS,
  pickStartupEmptySubtitleIndex,
} from './startupEmptySubtitle';

describe('pickStartupEmptySubtitleIndex', () => {
  it('selects a startup subtitle index by normalized random value', () => {
    expect(pickStartupEmptySubtitleIndex(0)).toBe(0);
    expect(pickStartupEmptySubtitleIndex(0.999999)).toBe(
      STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS.length - 1
    );
  });

  it('clamps invalid random values instead of escaping the candidate list', () => {
    expect(pickStartupEmptySubtitleIndex(-1)).toBe(0);
    expect(pickStartupEmptySubtitleIndex(2)).toBe(
      STARTUP_EMPTY_SUBTITLE_MESSAGE_KEYS.length - 1
    );
    expect(pickStartupEmptySubtitleIndex(Number.NaN)).toBe(0);
  });
});
