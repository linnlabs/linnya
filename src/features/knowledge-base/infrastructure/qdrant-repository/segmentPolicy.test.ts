import { describe, expect, it } from 'vitest';

import {
  buildSegmentOptimizerPatch,
  readConfiguredTargetSegmentCount,
  resolveTargetSegmentCountByPointsCount,
} from './segmentPolicy';

describe('segmentPolicy', () => {
  it('应按 points_count 返回目标段数', () => {
    expect(resolveTargetSegmentCountByPointsCount(0)).toBe(1);
    expect(resolveTargetSegmentCountByPointsCount(19_999)).toBe(1);
    expect(resolveTargetSegmentCountByPointsCount(20_000)).toBe(1);
    expect(resolveTargetSegmentCountByPointsCount(20_001)).toBe(2);
    expect(resolveTargetSegmentCountByPointsCount(100_001)).toBe(4);
    expect(resolveTargetSegmentCountByPointsCount(500_001)).toBe(0);
  });

  it('应从 collection config 读取当前目标段数', () => {
    expect(readConfiguredTargetSegmentCount({})).toBe(0);
    expect(readConfiguredTargetSegmentCount({ optimizer_config: {} })).toBe(0);
    expect(
      readConfiguredTargetSegmentCount({
        optimizer_config: { default_segment_number: 1 },
      })
    ).toBe(1);
    expect(
      readConfiguredTargetSegmentCount({
        optimizer_config: { default_segment_number: 2 },
      })
    ).toBe(2);
    expect(
      readConfiguredTargetSegmentCount({
        optimizer_config: { default_segment_number: 4 },
      })
    ).toBe(4);
  });

  it('应生成合法的 PATCH 结构', () => {
    expect(buildSegmentOptimizerPatch(1)).toEqual({
      optimizers_config: { default_segment_number: 1 },
    });
    expect(buildSegmentOptimizerPatch(0)).toEqual({
      optimizers_config: { default_segment_number: 0 },
    });
  });
});

