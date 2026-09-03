import { describe, expect, it } from 'vitest';
import { resolveConversationEstimationWidth } from './conversationContentWidth';

describe('resolveConversationEstimationWidth', () => {
  it('uses the real content column width and removes the shared side gaps', () => {
    expect(resolveConversationEstimationWidth({
      contentColumnWidthPx: 800,
      contentSideGapPx: 22,
    })).toBe(756);
  });

  it('keeps narrow panes on the established minimum estimation width', () => {
    expect(resolveConversationEstimationWidth({
      contentColumnWidthPx: 320,
      contentSideGapPx: 22,
    })).toBe(360);
  });

  it('normalizes subpixel layout results to the estimator cache precision', () => {
    expect(resolveConversationEstimationWidth({
      contentColumnWidthPx: 700.4,
      contentSideGapPx: 21.75,
    })).toBe(657);
  });
});
