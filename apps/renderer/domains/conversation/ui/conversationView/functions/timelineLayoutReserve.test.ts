import { describe, expect, it } from 'vitest';
import {
  calculateTimelineLayoutAnimationReserve,
  calculateTimelineAwareContentWidth,
  calculateTimelineLayoutReserve,
} from './timelineLayoutReserve';

describe('timeline layout reserve', () => {
  it('does not reserve message width when the timeline is collapsed', () => {
    expect(calculateTimelineLayoutReserve({
      columnMaxWidth: 800,
      contentBoxWidth: 500,
      isTimelineCollapsed: true,
      timelineReserve: 34,
    })).toBe(0);
  });

  it('keeps the full column width when side space can contain the expanded timeline', () => {
    expect(calculateTimelineAwareContentWidth({
      columnMaxWidth: 800,
      contentBoxWidth: 900,
      isTimelineCollapsed: false,
      timelineReserve: 34,
    })).toBe(800);
  });

  it('reserves space from the right side only when the container is narrow', () => {
    expect(calculateTimelineAwareContentWidth({
      columnMaxWidth: 800,
      contentBoxWidth: 500,
      isTimelineCollapsed: false,
      timelineReserve: 34,
    })).toBe(466);
  });

  it('preserves the original left blank space while reserving the narrow right side', () => {
    expect(calculateTimelineAwareContentWidth({
      columnMaxWidth: 800,
      contentBoxWidth: 850,
      isTimelineCollapsed: false,
      timelineReserve: 34,
    })).toBe(791);
  });

  it('animates from the max-width clamp boundary when opening near the column limit', () => {
    expect(calculateTimelineLayoutAnimationReserve({
      columnMaxWidth: 800,
      contentBoxWidth: 850,
      currentReserve: 0,
      isTimelineCollapsed: false,
      timelineReserve: 34,
    })).toEqual({
      finalReserve: 34,
      startContentWidth: 800,
      targetContentWidth: 791,
      startReserve: 25,
      targetReserve: 34,
    });
  });

  it('collapses back to the clamp boundary before writing the semantic zero reserve', () => {
    expect(calculateTimelineLayoutAnimationReserve({
      columnMaxWidth: 800,
      contentBoxWidth: 850,
      currentReserve: 34,
      isTimelineCollapsed: true,
      timelineReserve: 34,
    })).toEqual({
      finalReserve: 0,
      startContentWidth: 791,
      targetContentWidth: 800,
      startReserve: 34,
      targetReserve: 25,
    });
  });

  it('does not require a visible content animation when wide side space contains the timeline', () => {
    expect(calculateTimelineLayoutAnimationReserve({
      columnMaxWidth: 800,
      contentBoxWidth: 900,
      currentReserve: 0,
      isTimelineCollapsed: false,
      timelineReserve: 34,
    })).toEqual({
      finalReserve: 0,
      startContentWidth: 800,
      targetContentWidth: 800,
      startReserve: 50,
      targetReserve: 50,
    });
  });
});
